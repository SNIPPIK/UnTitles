use crossbeam_utils::CachePadded;
use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::atomic::{AtomicUsize, Ordering},
};

/// SPSC lock-free кольцевой буфер для `Vec<u8>`.
///
/// Архитектура:
///
/// Producer:
///     - изменяет `head`
///     - читает `tail`
///
/// Consumer:
///     - изменяет `tail`
///     - читает `head`
///
/// Важно:
/// - один producer;
/// - один consumer;
/// - producer и consumer могут работать одновременно.
///
/// Все данные публикуются через Release/Acquire.
///
/// Основная цель этого буфера — не допускать тихого уничтожения RTP/Opus
/// пакетов при заполнении очереди.
pub struct RingBuffer {
    /// Фиксированное хранилище слотов.
    ///
    /// `MaybeUninit` позволяет не создавать `Vec<u8>` заранее.
    /// Каждый слот получает объект только в момент `push`.
    buffer: Box<[UnsafeCell<MaybeUninit<Vec<u8>>>]>,

    /// Количество физических слотов.
    capacity: usize,

    /// Следующая позиция producer.
    ///
    /// Изменяется только producer.
    head: CachePadded<AtomicUsize>,

    /// Следующая позиция consumer.
    ///
    /// Изменяется только consumer.
    tail: CachePadded<AtomicUsize>
}

// SAFETY:
// Буфер предназначен для SPSC.
//
// Producer работает только со своим head.
// Consumer работает только со своим tail.
//
// Доступ к содержимому слотов синхронизирован публикацией head/tail
// через Release/Acquire.
unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
    /// Создаёт пустой ring buffer.
    ///
    /// `capacity` — максимальное количество одновременно хранимых пакетов.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "RingBuffer capacity must be greater than zero");

        let mut slots = Vec::with_capacity(capacity);

        for _ in 0..capacity {
            slots.push(UnsafeCell::new(MaybeUninit::uninit()));
        }

        Self {
            buffer: slots.into_boxed_slice(),
            capacity,

            head: CachePadded::new(AtomicUsize::new(0)),
            tail: CachePadded::new(AtomicUsize::new(0)),
        }
    }

    // ========================================================================
    // Internal
    // ========================================================================

    /// Преобразует логическую позицию в физический индекс.
    ///
    /// `%` здесь намеренно оставлен простым:
    /// capacity у нас обычно 2048/4096/8192, но API позволяет и другие
    /// значения.
    #[inline(always)]
    fn index(&self, position: usize) -> usize {
        position % self.capacity
    }

    // ========================================================================
    // Producer
    // ========================================================================

    /// Пытается добавить один пакет.
    ///
    /// `Ok(())`
    ///     Пакет успешно записан.
    ///
    /// `Err(packet)`
    ///     Буфер заполнен. Исходный `Vec<u8>` возвращается caller'у.
    ///
    /// Никакого silent drop.
    #[inline(always)]
    pub fn push(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        let head = self.head.load(Ordering::Relaxed);

        // Consumer публикует освобождённые слоты через Release,
        // поэтому producer читает tail через Acquire.
        let tail = self.tail.load(Ordering::Acquire);

        let used = head.wrapping_sub(tail);

        // Очередь полностью заполнена.
        if used >= self.capacity {
            return Err(value);
        }

        let index = self.index(head);

        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Очень важно:
        // данные должны быть записаны ДО публикации нового head.
        self.head
            .store(head.wrapping_add(1), Ordering::Release);

        Ok(())
    }

    /// Пытается добавить пакет в начало очереди.
    ///
    /// Используется для возврата уже извлечённого пакета,
    /// например если отправка UDP завершилась ошибкой.
    ///
    /// `Ok(())` — пакет возвращён.
    /// `Err(packet)` — места нет.
    ///
    /// Вызов должен выполняться consumer-потоком.
    #[inline(always)]
    pub fn push_up(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Relaxed);

        let used = head.wrapping_sub(tail);

        if used >= self.capacity {
            return Err(value);
        }

        // Сдвигаем начало очереди назад на один слот.
        let new_tail = tail.wrapping_sub(1);
        let index = self.index(new_tail);

        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Публикуем новый front после записи данных.
        self.tail
            .store(new_tail, Ordering::Release);

        Ok(())
    }

    /// Пытается добавить несколько пакетов.
    ///
    /// Возвращает количество реально добавленных элементов.
    ///
    /// ВАЖНО:
    /// Если очередь заполнится, хвост входного iterator будет отброшен
    /// самим caller'ом после возврата.
    ///
    /// Для критического audio/RTP пути используй `push_many_blocking`.
    #[inline]
    pub fn push_many<I>(&self, values: I) -> usize
    where
        I: IntoIterator<Item = Vec<u8>>,
    {
        // Текущие позиции головы и хвоста.
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);

        // Число занятых слотов (wrapping-разность).
        let used = head.wrapping_sub(tail);
        // Свободные слоты (защита от переполнения через saturating_sub).
        let free = self.capacity.saturating_sub(used);

        // Если очередь заполнена — выходим.
        if free == 0 {
            return 0;
        }

        let mut written = 0usize;

        // Берём не более `free` элементов из итератора.
        for value in values.into_iter().take(free) {
            // Пустые пакеты не имеют смысла для RTP.
            if value.is_empty() {
                continue;
            }

            let index = self.index(head.wrapping_add(written));

            // Пишем в слот без дополнительной синхронизации — слот гарантированно
            // свободен, поскольку мы уже посчитали `free` и не превышаем его.
            unsafe {
                (*self.buffer[index].get()).write(value);
            }

            written += 1;
        }

        if written != 0 {
            // Публикуем весь batch одной атомарной операцией.
            self.head
                .store(head.wrapping_add(written), Ordering::Release);
        }

        written
    }

    // ========================================================================
    // Consumer
    // ========================================================================

    /// Извлекает один пакет.
    ///
    /// `None` — очередь пуста.
    #[inline(always)]
    pub fn pop(&self) -> Option<Vec<u8>> {
        // Consumer владеет tail.
        let tail = self.tail.load(Ordering::Relaxed);

        // Producer публикует новые данные через Release.
        let head = self.head.load(Ordering::Acquire);

        if tail == head {
            return None;
        }

        let index = self.index(tail);

        // Consumer — единственный владелец этого элемента, конкурентов нет.
        // Читаем значение из MaybeUninit, перенося владение наружу.
        let value = unsafe {
            (*self.buffer[index].get())
                .assume_init_read()
        };

        // Освобождаем слот после того, как забрали значение.
        self.tail
            .store(tail.wrapping_add(1), Ordering::Release);

        Some(value)
    }

    /// Извлекает до `limit` пакетов.
    ///
    /// API сохранён в том виде, который используется проектом:
    ///
    ///     buffer.pop_many(&mut extracted, limit);
    ///
    /// Метод ничего не возвращает.
    #[inline]
    pub fn pop_many(&self, out: &mut Vec<Vec<u8>>, limit: usize) {
        if limit == 0 {
            return;
        }

        // Consumer владеет tail — можно читать под Relaxed.
        let tail = self.tail.load(Ordering::Relaxed);

        // Один snapshot головы под Acquire, чтобы увидеть все опубликованные данные.
        let head = self.head.load(Ordering::Acquire);

        // Сколько элементов реально доступно прямо сейчас.
        // А wrapping_sub защищает от гонки при переполнении счётчиков,
        // min(capacity) ограничивает значение сверху.
        let available = head
            .wrapping_sub(tail)
            .min(self.capacity);

        // Никогда не читаем больше запрошенного.
        let count = available.min(limit);

        if count == 0 {
            return;
        }

        // Заранее резервируем место в выходном векторе.
        out.reserve(count);

        // Читаем `count` элементов подряд, начиная с текущего tail.
        for offset in 0..count {
            let index = self.index(
                tail.wrapping_add(offset)
            );

            // Consumer — единственный владелец, конкуренции нет.
            // Переносим владение из MaybeUninit наружу.
            let value = unsafe {
                (*self.buffer[index].get())
                    .assume_init_read()
            };

            out.push(value);
        }

        // Все извлечённые элементы публикуются одним store.
        self.tail.store(
            tail.wrapping_add(count),
            Ordering::Release,
        );
    }

    // ========================================================================
    // State
    // ========================================================================

    /// Текущее количество пакетов.
    ///
    /// Значение — мгновенный snapshot: при конкурентном доступе оно может
    /// устареть сразу после возврата. Используется для метрик и грубых проверок.
    #[inline]
    pub fn len(&self) -> usize {
        // Acquire на обоих счётчиках — хотим видеть согласованное состояние
        // публикаций и освобождений слотов.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        head.wrapping_sub(tail)
            .min(self.capacity)
    }

    /// Возвращает количество свободных слотов для записи.
    ///
    /// Используется producer'ом для оценки, сколько элементов можно
    /// добавить без ожидания освобождения места.
    #[inline]
    pub fn free_slots(&self) -> usize {
        self.capacity.saturating_sub(self.len())
    }

    /// Проверяет, пуст ли буфер.
    ///
    /// Snapshot-проверка: результат может устареть сразу после возврата.
    #[inline]
    pub fn is_empty(&self) -> bool {
        // Оба счётчика под Acquire — нужна согласованная картина.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        // Пусто, когда позиции головы и хвоста совпадают.
        head == tail
    }

    /// Проверяет, заполнен ли буфер полностью.
    ///
    /// Snapshot-проверка: если результат `true`, следующий `push` может
    /// всё ещё пройти, если consumer успел освободить слот.
    #[inline]
    pub fn is_full(&self) -> bool {
        // head — только под Relaxed (это поле producer'а).
        let head = self.head.load(Ordering::Relaxed);
        // tail под Acquire — важно увидеть освобождения от consumer'а.
        let tail = self.tail.load(Ordering::Acquire);

        // Разница не меньше ёмкости — все слоты заняты.
        head.wrapping_sub(tail) >= self.capacity
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /// Полностью очищает буфер.
    ///
    /// Вызывать только когда producer/consumer остановлены.
    pub fn clear(&self) {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Relaxed);

        let count = head
            .wrapping_sub(tail)
            .min(self.capacity);

        // Дропаем только реально занятые слоты.
        for offset in 0..count {
            let index = self.index(
                tail.wrapping_add(offset)
            );

            unsafe {
                (*self.buffer[index].get())
                    .assume_init_drop();
            }
        }

        // После полной остановки потоков можно сбросить индексы.
        self.head.store(0, Ordering::Relaxed);
        self.tail.store(0, Ordering::Relaxed);
    }
}

impl Drop for RingBuffer {
    fn drop(&mut self) {
        // К моменту Drop producer/consumer должны быть остановлены.
        self.clear();
    }
}