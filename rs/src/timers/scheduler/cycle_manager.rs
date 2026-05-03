use crate::network::udp::UdpBuffered;
use arc_swap::ArcSwap;
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
    thread,
};

// Ограничиваем максимальное количество тиков за раз (чтобы не создать burst)
const CATCH_LIMIT: u32 = 2; // или interval_duration * 2, но лучше фиксированное число

/// Менеджер циклического вызова `tick()` для группы UDP-сессий.
pub struct CycleManager {
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,
    running: Arc<AtomicBool>,
    /// Теперь используем JoinHandle от std::thread
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    interval: Duration
}

impl CycleManager {
    /// Создаёт новый менеджер с интервалом в миллисекундах.
    pub fn new() -> Self {
        CycleManager {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            interval: Duration::from_millis(20)
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

    /// Синхронная остановка (т.к. потоки std не требуют await)
    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
        let handle = self.handle.lock().unwrap().take();
        if let Some(h) = handle {
            let _ = h.join();
        }
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

        let handle = thread::spawn(move || {
            let mut next_tick = Instant::now();

            while running_flag.load(Ordering::Relaxed) {
                // Снимаем снапшот данных
                let snapshot = sessions_ptr.load();
                let items: Vec<_> = snapshot.values().collect();

                if items.is_empty() {
                    // Если пусто, просто спим и сбрасываем время следующего тика
                    thread::sleep(interval_duration);
                    next_tick = Instant::now();
                    continue;
                }

                let now = Instant::now();

                // Проверяем, не пора ли делать тик
                if now >= next_tick {
                    let elapsed_since_last = now.duration_since(next_tick);
                    let missed_ticks = (elapsed_since_last.as_nanos() / interval_duration.as_nanos()) as u32;

                    // Основной тик
                    items.iter().for_each(|item| item.tick());

                    // Компенсация пропущенных тиков (аналог Burst/Catch-up)
                    if missed_ticks > 0 {
                        let catch_up = missed_ticks.min(CATCH_LIMIT);
                        for _ in 0..catch_up {
                            items.iter().for_each(|item| item.tick());
                        }
                        // Сдвигаем время следующего тика с учетом компенсации
                        next_tick += interval_duration * (1 + catch_up);
                    } else {
                        next_tick += interval_duration;
                    }
                }

                // Вычисляем паузу до следующего тика
                let sleep_time = next_tick.checked_duration_since(Instant::now()).unwrap_or(Duration::ZERO);
                if sleep_time > Duration::ZERO {
                    thread::sleep(sleep_time);
                }
            }
        });

        *handle_guard = Some(handle);
    }
}

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.running.store(false, Ordering::SeqCst);
        // В std::thread мы можем попытаться подождать завершения,
        // но лучше вызвать shutdown() явно, если нужна гарантия.
        let mut handle_guard = self.handle.lock().unwrap();
        if let Some(h) = handle_guard.take() {
            let _ = h.join();
        }
    }
}