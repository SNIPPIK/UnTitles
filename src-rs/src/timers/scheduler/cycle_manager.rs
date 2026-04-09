use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio::{
    time,
};
use arc_swap::ArcSwap;
use crate::network::udp::UdpBuffered;

/// Менеджер циклического вызова `tick()` для группы UDP-сессий.
/// Использует `ArcSwap<HashMap<...>>` для потокобезопасного хранения сессий.
/// Почему не `DashMap`? Потому что нам нужно атомарно заменять всю таблицу при добавлении/удалении,
/// чтобы итерация в фоновом потоке была по консистентному снимку (snapshot) без блокировок на время обхода.
/// `ArcSwap` даёт атомарную замену указателя, а фоновый поток работает со старым снимком, пока не возьмёт новый.
pub struct CycleManager {
    /// Атомарно заменяемый указатель на текущую карту сессий.
    /// Ключ — ID сессии, значение — `Arc<UdpBuffered>`.
    /// Плюсы: итерация по снимку не блокирует добавление/удаление.
    /// Минусы: при каждом изменении копируется вся `HashMap` (что приемлемо при <=50 сессий на воркер).
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    /// Флаг остановки фонового потока.
    running: Arc<AtomicBool>,

    /// Дескриптор асинхронной задачи Tokio.
    /// Используется `tokio::task::JoinHandle`, потому что цикл должен работать в асинхронной среде.
    /// Если бы мы использовали `std::thread`, то спам потоками при большом количестве воркеров был бы проблемой.
    //handle: Mutex<Option<JoinHandle<()>>>,
    handle: Mutex<Option<tokio::task::JoinHandle<()>>>,

    /// Интервал между вызовами `tick()` для всей группы сессий.
    interval: Duration,
}

impl CycleManager {
    /// Создаёт новый менеджер с интервалом в миллисекундах.
    pub fn new(interval_ms: f64) -> Self {
        let interval = Duration::from_secs_f64(interval_ms / 1000.0);
        Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            interval,
        }
    }

    /// Добавляет сессию. При первом добавлении автоматически запускает фоновый цикл.
    /// **Важно:** копирует всю `HashMap` при каждом добавлении. При большом количестве сессий (>1000) это может быть дорого.
    /// В нашем случае на один воркер приходится не более `MAX_PER_WORKER` сессий, так что OK.
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        // Загружаем текущую карту и делаем её мутабельной (через `Arc::make_mut`).
        // Это создаст новый `Arc`, если текущий разделяемый, или модифицирует существующий, если владение единственное.
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).insert(id, session);
        // Атомарно заменяем указатель. Старая карта останется у тех, кто её держит (например, у фонового потока, если он сейчас итерируется).
        self.sessions.store(map);

        self.start_if_needed();
    }

    /// Удаляет сессию аналогично добавлению.
    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);
    }

    /// Запускает фоновую задачу, если она ещё не запущена.
    /// Использует `compare_exchange`, чтобы избежать гонки при одновременном вызове из нескольких потоков.
    fn start_if_needed(&self) {
        // Пытаемся переключить флаг с false на true. Если не удалось — значит, уже запущено.
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        let mut handle_guard = self.handle.lock().unwrap();

        // Двойная проверка: возможно, пока мы ждали мьютекс, задача уже была создана другим потоком.
        if handle_guard.is_some() { return; }

        let sessions_ptr = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval_duration = self.interval;

        let handle = tokio::spawn(async move {
            let start = time::Instant::now();
            let mut tick_counter: u32 = 0;

            while running_flag.load(Ordering::Relaxed) {
                let snapshot = sessions_ptr.load();
                let values = snapshot.values();

                let now = time::Instant::now();
                let ideal_next = start + interval_duration * (tick_counter + 1);

                if now > ideal_next {
                    // Отставание: сколько тиков должны были произойти?
                    let missed = ((now - start).as_nanos() / interval_duration.as_nanos()) as u32;
                    let to_catch = missed - tick_counter;
                    // Ограничиваем максимальное количество тиков за раз (чтобы не создать burst)
                    let catch_limit = 2; // или interval_duration * 2, но лучше фиксированное число
                    let catch_up = to_catch.min(catch_limit);

                    for _ in 0..catch_up {
                        tick_counter += 1;
                        // Вызываем tick с информацией о том, что это "компенсирующий" тик
                        values.clone().for_each(|value| value.tick());
                    }
                    // После компенсации продолжаем без дополнительного сна
                    continue;
                }

                // Не отстаём — ждём до идеального времени
                time::sleep_until(ideal_next).await;
                tick_counter += 1;
                values.for_each(|value| value.tick());
            }

            /*let mut next_tick = time::Instant::now() + interval_duration;

            while running_flag.load(Ordering::Relaxed) {
                let now = time::Instant::now();

                let snapshot = sessions_ptr.load();
                let values = snapshot.values();

                // Если сильно отстали — догоняем
                if now >= next_tick {
                    let delay = now.duration_since(next_tick);

                    // 🔥 ограничиваем догон (чтобы не было burst)
                    let max_catchup = interval_duration * 2;

                    if delay >= max_catchup {
                        next_tick = now + interval_duration;
                    } else {
                        next_tick += interval_duration;
                    }
                }

                values.for_each(|value| value.tick());

                // Ждём до следующего тика
                time::sleep_until(next_tick).await;

                next_tick += interval_duration;
            }*/
        });

        *handle_guard = Some(handle);
    }

    /// Останавливает фоновую задачу и дожидается её завершения.
    /// Вызывается при `Drop` или вручную.
    pub async fn stop(&self) {
        self.running.store(false, Ordering::Release);

        // Забираем handle из мьютекса и ожидаем его.
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.await;
        }
    }
}

impl Drop for CycleManager {
    fn drop(&mut self) {
        // В `drop` нельзя использовать асинхронность, поэтому запускаем синхронную блокировку.
        // Это может быть неидеально, но для управляемого выключения (например, при завершении программы) подходит.
        let _ = self.stop();
    }
}