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
use tokio::time::{sleep_until, Instant, MissedTickBehavior};
use crate::network::udp::UdpBuffered;

// Ограничиваем максимальное количество тиков за раз (чтобы не создать burst)
const CATCH_LIMIT: u32 = 2; // или interval_duration * 2, но лучше фиксированное число

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
    handle: Mutex<Option<tokio::task::JoinHandle<()>>>,

    /// Интервал между вызовами `tick()` для всей группы сессий.
    interval: Duration,
}

impl CycleManager {
    /// Создаёт новый менеджер с интервалом в миллисекундах.
    pub fn new() -> Self {
        let interval = Duration::from_millis(20);
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

    /// Асинхронный стоп с гарантией завершения задачи.
    pub async fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
        let handle = self.handle.lock().unwrap().take();
        if let Some(h) = handle {
            let _ = h.await;
        }
    }

    /// Запускает фоновую задачу, если она ещё не запущена.
    /// Использует `compare_exchange`, чтобы избежать гонки при одновременном вызове из нескольких потоков.
    fn start_if_needed(&self) {
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return;
        }

        let mut handle_guard = self.handle.lock().unwrap();
        if handle_guard.is_some() { return; }

        let sessions_ptr = self.sessions.clone();
        let running_flag = self.running.clone();
        let interval_duration = self.interval;

        let handle = tokio::spawn(async move {
            // Гибридный таймер:
            // - interval для защиты от накопления тиков (Skip behaviour)
            // - собственный ideal-time счетчик для высокой точности и catch-up
            let mut interval = time::interval(interval_duration);
            interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

            let start = Instant::now();
            let mut last_ideal = start;
            let mut tick_index: u64 = 0;

            while running_flag.load(Ordering::Relaxed) {
                // Ждём next tick от Tokio (защищает от "burst" когда таск просыпается часто)
                interval.tick().await;

                // Snapshot сессий
                let snapshot = sessions_ptr.load();
                if snapshot.is_empty() {
                    // Обновим last_ideal и индекс, чтобы не накапливать отставание на пустых итерациях
                    tick_index = tick_index.saturating_add(1);
                    last_ideal += interval_duration;
                    continue;
                }

                let now = Instant::now();
                // Вычисляем сколько тиков должно было пройти с момента старта
                let expected_ticks = ((now - start).as_nanos() / interval_duration.as_nanos()) as u64;

                // Сколько тиков мы еще не выполнили
                let missed_total = expected_ticks.saturating_sub(tick_index);
                if missed_total > 0 {
                    // Ограничиваем количество догоняющих тиков
                    let catch_up = (missed_total as u32).min(CATCH_LIMIT) as u64;

                    // Выполняем догоняющие тики
                    for _ in 0..catch_up {
                        snapshot.values().for_each(|s| s.tick());
                        tick_index = tick_index.saturating_add(1);
                        last_ideal += interval_duration;
                    }

                    // Если после catch_up всё ещё есть значительное отставание,
                    // позволяем следующей итерации быстро обработать оставшиеся (Skip предотвратит burst).
                    // Переходим к следующему шагу без sleep, чтобы оценить текущее состояние.
                }

                // Выполняем один основной тик для текущего интервала (если не был выполнен как часть catch_up)
                // Проверяем, не выполнили ли мы уже тик для текущего expected_ticks
                let now_expected = ((now - start).as_nanos() / interval_duration.as_nanos()) as u64;
                if tick_index <= now_expected {
                    snapshot.values().for_each(|s| s.tick());
                    tick_index = tick_index.saturating_add(1);
                    last_ideal += interval_duration;
                }

                // Рассчитываем идеальное время следующего тика и ждать его (без накопления)\
                let ideal_next = start + Duration::from_nanos(interval_duration.as_nanos() as u64 * tick_index);
                // Если идеальное время уже прошло, не ждем — следующая loop (interval.tick()) решит
                if Instant::now() < ideal_next {
                    sleep_until(ideal_next).await;
                }
            }
        });

        *handle_guard = Some(handle);
    }
    /*fn start_if_needed(&self) {
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
            // Создаём интервал с поведением Skip – он никогда не накапливает пропущенные тики
            let mut interval = time::interval(interval_duration);
            interval.set_missed_tick_behavior(MissedTickBehavior::Skip);

            // Для отслеживания идеального времени последнего выполненного тика
            let mut last_ideal_tick = Instant::now();
            while running_flag.load(Ordering::Relaxed) {
                // Ждём следующего тика согласно интервалу (Skip гарантирует, что не будет burst от tokio)
                interval.tick().await;

                // Снимаем снапшот данных
                let snapshot = sessions_ptr.load();
                let items: Vec<_> = snapshot.values().collect();

                if items.is_empty() {
                    continue;
                }

                let now = Instant::now();
                // Вычисляем, сколько тиков мы пропустили с момента последнего идеального выполнения
                let expected_elapsed = now.duration_since(last_ideal_tick);
                let expected_ticks = (expected_elapsed.as_nanos() / interval_duration.as_nanos()) as u32;

                // Если отставание больше 1 тика, выполняем ограниченное число компенсационных шагов
                let missed_ticks = expected_ticks.saturating_sub(1); // вычитаем 1, т.к. текущий тик будет выполнен
                let catch_up = missed_ticks.min(CATCH_LIMIT);

                // Сначала выполняем догоняющие тики (если есть)
                for _ in 0..catch_up {
                    items.iter().for_each(|item| item.tick());
                }

                // Выполняем текущий, основной тик
                items.iter().for_each(|item| item.tick());

                // Обновляем last_ideal_tick до того момента, который должен был быть
                // для последнего выполненного тика (с учетом догоняющих)
                // Формула: last_ideal_tick + (1 + catch_up) * interval_duration
                last_ideal_tick += interval_duration * (1 + catch_up);
            }
        });

        let handle = tokio::spawn(async move {
            let start = Instant::now();
            let mut tick_counter: u32 = 0;

            while running_flag.load(Ordering::Relaxed) {
                let snapshot = sessions_ptr.load();

                let now = Instant::now();
                let ideal_next = start + interval_duration * (tick_counter);

                if now >= ideal_next {
                    // Отставание: сколько тиков должны были произойти?
                    let missed = ((now - start).as_nanos() / interval_duration.as_nanos()) as u32;
                    let to_catch = missed - tick_counter;
                    let catch_up = to_catch.min(CATCH_LIMIT);

                    for _ in 0..catch_up {
                        tick_counter += 1;
                        // Вызываем tick с информацией о том, что это "компенсирующий" тик
                        snapshot.values().for_each(|value| value.tick());
                    }
                    // После компенсации продолжаем без дополнительного сна
                    continue;
                }

                tick_counter += 1;
                snapshot.values().for_each(|value| value.tick());

                // Не отстаём — ждём до идеального времени
                time::sleep_until(ideal_next).await;
            }
        });

        *handle_guard = Some(handle);
    }*/

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