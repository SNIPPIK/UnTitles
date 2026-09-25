//! Движок аудио-буфера поверх процесса FFmpeg.
//!
//! Модуль разбит на части по ответственности:
//! * [`constants`] — константы (флаги FFmpeg, лимиты парсера);
//! * [`start`] — запуск FFmpeg и потока чтения;
//! * [`reader`]— тело фонового потока чтения stdout;
//! * [`lifecycle`] — уничтожение и `Drop`;
//! * [`buffer_ops`] — операции над кольцевым буфером и позицией.

mod buffer_ops;
mod constants;
mod lifecycle;
mod reader;
mod start;

use crate::structures::audio::ring_buffer::RingBuffer;
use napi_derive::napi;
use std::{
    process::Child,
    sync::{
        atomic::{AtomicBool, AtomicUsize},
        Arc, Condvar, Mutex,
    },
    thread::JoinHandle,
};

/// Движок аудио-буфера, связанный с процессом FFmpeg и потоком чтения.
///
/// Управляет жизненным циклом дочернего процесса FFmpeg и фонового потока,
/// который читает его stdout, разбирает Ogg/Opus и складывает готовые
/// аудио-пакеты в кольцевой буфер. Операции над буфером и позицией
/// вынесены в отдельные модули (`buffer_ops`, `lifecycle`, `start`, `reader`).
#[napi]
pub struct AudioEngine {
    /// Дочерний процесс FFmpeg. Мьютекс нужен для безопасного доступа и kill.
    pub(crate) child: Mutex<Option<Child>>,

    /// Флаг активности потока чтения. `true` — поток работает.
    pub(crate) reading_active: Arc<AtomicBool>,

    /// Флаг уничтожения движка. После `true` дальнейшие операции запрещены.
    pub(crate) destroyed: Arc<AtomicBool>,

    /// Дескриптор потока чтения. Хранится в мьютексе для join при остановке.
    pub(crate) reader_handle: Mutex<Option<JoinHandle<()>>>,

    /// Состояние паузы: (флаг паузы, condvar для пробуждения).
    ///
    /// Поток чтения проверяет флаг и засыпает на condvar, пока пауза активна.
    pub(crate) pause_state: Arc<(Mutex<bool>, Condvar)>,

    /// Кольцевой буфер с Opus-пакетами и condvar для уведомления о появлении места.
    ///
    /// Reader наполняет буфер, consumer (JS) извлекает пакеты через `get_packets`.
    pub(crate) buffer: Arc<(Mutex<RingBuffer>, Condvar)>,

    /// Максимальная ёмкость буфера (число пакетов).
    pub(crate) max_capacity: usize,

    /// Позиция чтения (количество извлечённых пакетов).
    pub(crate) position: Arc<AtomicUsize>,

    /// Сериализует процесс уничтожения.
    ///
    /// Нужен для того, чтобы конкурентные вызовы `destroy()`
    /// не возвращались до фактического завершения первого destroy.
    destroy_lock: Mutex<()>
}

#[napi]
impl AudioEngine {
    /// Создаёт движок с буфером заданной ёмкости.
    ///
    /// Ёмкость рассчитывается как `50 * 60 * max_minutes` пакетов
    /// (50 пакетов/сек * 60 сек * минуты), но не менее 1500 пакетов (~30 секунд).
    ///
    /// # Аргументы
    /// * `max_minutes` — максимальная длительность аудио в минутах.
    ///
    /// # Возвращаемое значение
    /// Новый экземпляр `AudioEngine` в остановленном состоянии.
    #[napi(constructor)]
    pub fn new(max_minutes: u32) -> Self {
        // 50 пакетов/сек * 60 сек * минуты, минимум 1500.
        let capacity = (50u32 * 60 * max_minutes).max(1500) as usize;

        Self {
            // Процесс FFmpeg ещё не запущен.
            child: Mutex::new(None),

            // Reader неактивен до вызова start().
            reading_active: Arc::new(AtomicBool::new(false)),

            // Движок не уничтожен.
            destroyed: Arc::new(AtomicBool::new(false)),

            // Handle потока отсутствует.
            reader_handle: Mutex::new(None),

            // Пауза снята, condvar инициализирован.
            pause_state: Arc::new((Mutex::new(false), Condvar::new())),

            // Кольцевой буфер на рассчитанную ёмкость + condvar.
            buffer: Arc::new((Mutex::new(RingBuffer::new(capacity)), Condvar::new())),

            // Максимальная ёмкость = ёмкость буфера.
            max_capacity: capacity,

            // Позиция чтения начинается с нуля.
            position: Arc::new(AtomicUsize::new(0)),

            destroy_lock: Mutex::new(())
        }
    }
}