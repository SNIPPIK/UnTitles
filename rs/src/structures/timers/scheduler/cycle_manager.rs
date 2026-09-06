use crate::structures::network::udp::UdpBuffered;
use crate::utils::duration::now_ms;
use arc_swap::ArcSwap;
use std::{
    collections::HashMap,
    io,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant}
};


/// Интервал между тиками цикла обработки UDP-пакетов (мс).
pub const TICK_INTERVAL_MS: u64 = 20;

/// Интервал как `Duration` для прямого использования в вычислениях.
const TICK_INTERVAL: Duration =
    Duration::from_millis(TICK_INTERVAL_MS);

/// Порог, после которого вместо активного ожидания (spin) используется `Condvar` + таймер.
/// Позволяет избежать бесполезного занятия CPU.
const SPIN_MARGIN: Duration = Duration::from_micros(200);



/// Управляет фоновым потоком, который периодически вызывает `process()` для всех активных UDP-сессий.
///
/// Использует `ArcSwap` для хранения карты сессий, чтобы поток мог получать
/// актуальный снимок без блокировок, а добавление/удаление сессий выполнялось быстро.
pub struct CycleManager {
    /// Активные UDP-сессии (ключ — идентификатор сессии, значение — обёрнутый UDP-буфер).
    ///
    /// `ArcSwap` даёт возможность получения непротиворечивого снимка карты.
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    /// Флаг активности рабочего потока. `true` — поток должен работать.
    running: Arc<AtomicBool>,

    /// Состояние пробуждения потока:
    ///
    /// - `true` — поток должен немедленно проснуться (например, при добавлении сессии);
    /// - `false` — поток может спать до следующего тика.
    ///
    /// Используется совместно с `Condvar` для мгновенного пробуждения без ожидания таймера.
    wake_state: Arc<(Mutex<bool>, Condvar)>,

    /// Дескриптор фонового потока (JoinHandle).
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl CycleManager {
    /// Создаёт новый менеджер цикла с пустой картой сессий.
    /// Поток не запускается до добавления первой сессии.
    pub fn new() -> io::Result<Self> {
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            wake_state: Arc::new((Mutex::new(false), Condvar::new())),
            handle: Mutex::new(None),
        })
    }


    /// Добавляет сессию в карту и запускает фоновый поток, если он ещё не запущен.
    /// После добавления пробуждает поток для немедленной обработки.
    pub fn add_session(
        &self,
        id: u32,
        session: Arc<UdpBuffered>,
    ) {
        self.update_sessions(|map| {
            map.insert(id, session);
        });

        // Гарантируем, что поток работает.
        self.start_if_needed();
        // Немедленно будим поток, чтобы не ждать следующего тика.
        self.wake_thread();
    }


    /// Удаляет сессию по идентификатору.
    /// Если после удаления сессий не осталось, останавливает поток.
    pub fn remove_session(&self, id: u32) {
        self.update_sessions(|map| {
            map.remove(&id);
        });

        // Проверяем, остались ли сессии.
        if self.sessions.load().is_empty() {
            // Нет активных сессий — рабочий поток больше не нужен.
            self.shutdown();
        } else {
            // Будим поток, чтобы он заметил изменения.
            self.wake_thread();
        }
    }


    /// Применяет замыкание `update` к текущей карте сессий и сохраняет результат.
    ///
    /// Используется `Arc::make_mut` для копирования при необходимости,
    /// что позволяет безопасно обновлять карту, не затрагивая читателей.
    #[inline]
    fn update_sessions<F>(&self, update: F)
    where
        F: FnOnce(&mut HashMap<u32, Arc<UdpBuffered>>),
    {
        let mut current = self.sessions.load_full();

        // Если на current есть несколько Arc-ссылок (например, у worker-потока),
        // создаётся новая копия. Иначе модифицируем на месте.
        let map = Arc::make_mut(&mut current);

        update(map);

        // Публикуем обновлённую карту.
        self.sessions.store(current);
    }


    /// Запускает фоновый поток, если он ещё не запущен.
    ///
    /// Использует атомарный compare_exchange, чтобы избежать гонок
    /// при одновременном вызове из нескольких потоков.
    fn start_if_needed(&self) {
        // Пытаемся атомарно установить running = true.
        // Если уже true, значит поток работает — выходим.
        if self
            .running
            .compare_exchange(
                false,
                true,
                Ordering::AcqRel,
                Ordering::Acquire,
            )
            .is_err()
        {
            return;
        }

        let mut handle_guard = self
            .handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());

        // Если handle уже установлен (поток существует), сбрасываем running и выходим.
        if handle_guard.is_some() {
            self.running.store(false, Ordering::Release);
            return;
        }

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);
        let wake_state = Arc::clone(&self.wake_state);

        // Пытаемся создать поток.
        let spawn = thread::Builder::new()
            .name("UDPCycleSystem".into())
            .spawn(move || {
                cycle_thread(
                    sessions,
                    running,
                    wake_state,
                );
            });

        match spawn {
            Ok(handle) => {
                *handle_guard = Some(handle);
            }
            Err(error) => {
                self.running.store(false, Ordering::Release);
                eprintln!(
                    "[CycleManager] failed to spawn worker: {error}"
                );
            }
        }
    }


    /// Устанавливает флаг `wake` в `true` и уведомляет поток через `Condvar`.
    #[inline]
    fn wake_thread(&self) {
        let (lock, cvar) = &*self.wake_state;

        // Пытаемся захватить мьютекс и установить флаг.
        if let Ok(mut wake) = lock.lock() {
            *wake = true;
            cvar.notify_one();
        } else {
            // Если мьютекс отравлен, всё равно пробуем уведомить.
            cvar.notify_one();
        }
    }


    /// Останавливает фоновый поток и ожидает его завершения.
    ///
    /// Безопасен для повторного вызова.
    pub fn shutdown(&self) {
        // Запрещаем потоку дальнейшую работу.
        self.running.store(false, Ordering::Release);

        // Будим поток, чтобы он вышел из ожидания.
        self.wake_thread();

        // Забираем JoinHandle из мьютекса.
        let handle = {
            let mut guard = self
                .handle
                .lock()
                .unwrap_or_else(|e| e.into_inner());
            guard.take()
        };

        // Присоединяем поток вне блокировки мьютекса, чтобы избежать deadlock.
        if let Some(handle) = handle {
            let _ = handle.join();
        }
    }
}

/// Основной цикл фонового потока.
///
/// Пока `running == true`, выполняет:
/// 1. Получает snapshot активных сессий.
/// 2. Обрабатывает каждую сессию.
/// 3. Планирует следующий тик относительно абсолютной временной шкалы.
/// 4. Ожидает дедлайн через гибрид `sleep + spin`.
///
/// Важный момент:
/// следующий тик рассчитывается от предыдущего дедлайна, а не от
/// фактического времени завершения обработки. Это предотвращает
/// постепенный drift таймера.
fn cycle_thread(
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,
    running: Arc<AtomicBool>,
    wake_state: Arc<(Mutex<bool>, Condvar)>,
) {
    // ------------------------------------------------------------------------
    // Временная шкала цикла.
    // ------------------------------------------------------------------------

    let mut next_deadline = Instant::now();

    while running.load(Ordering::Acquire) {
        // --------------------------------------------------------------------
        // Обработка сессий.
        // --------------------------------------------------------------------

        #[cfg(debug_assertions)]
        let _process_start = Instant::now();

        {
            // Получаем snapshot карты сессий.
            //
            // ArcSwap гарантирует, что snapshot останется валидным
            // на протяжении всей области видимости.
            let snapshot = sessions.load();

            if !snapshot.is_empty() {
                let now = now_ms();

                for session in snapshot.values() {
                    session.process(now);
                }
            }

            // snapshot освобождается здесь.
        }

        // --------------------------------------------------------------------
        // Диагностика времени обработки.
        // --------------------------------------------------------------------

        #[cfg(debug_assertions)]
        {
            let elapsed = _process_start.elapsed();

            if elapsed >= TICK_INTERVAL {
                eprintln!(
                    "[CycleManager] tick overrun: {:?}",
                    elapsed
                );
            }
        }

        // --------------------------------------------------------------------
        // Проверяем остановку после обработки.
        // --------------------------------------------------------------------

        if !running.load(Ordering::Acquire) {
            break;
        }

        // --------------------------------------------------------------------
        // Планируем следующий абсолютный дедлайн.
        // --------------------------------------------------------------------

        next_deadline += TICK_INTERVAL;

        let now = Instant::now();

        // --------------------------------------------------------------------
        // Мы уже опоздали относительно запланированного тика.
        // --------------------------------------------------------------------

        if now >= next_deadline {
            let late = now.duration_since(next_deadline);

            let skipped =
                late.as_nanos() / TICK_INTERVAL.as_nanos();

            // Пропускаем все уже просроченные тики и планируем
            // ближайший будущий.
            //
            // Это предотвращает "догоняющий" цикл из нескольких
            // последовательных вызовов process().
            let advance = skipped.saturating_add(1);

            next_deadline +=
                TICK_INTERVAL * advance.min(u32::MAX as u128) as u32;

            continue;
        }

        // --------------------------------------------------------------------
        // Ожидаем следующий тик.
        // --------------------------------------------------------------------

        if !wait_until(
            next_deadline,
            &running,
            &wake_state,
        ) {
            break;
        }
    }

    // Поток завершён.
    running.store(false, Ordering::Release);
}


// ============================================================================
// ОЖИДАНИЕ
// ============================================================================

/// Ожидает наступления абсолютного `deadline`.
///
/// Используется гибридный алгоритм:
///
/// ```text
///             deadline
///                 │
///                 ▼
/// ────────────────┼────────────────────────
///       sleep    │       spin
///                 │
///       <-------->│<---->
///        SPIN_MARGIN
/// ```
///
/// Большую часть времени поток спит через `Condvar`, а последние
/// `SPIN_MARGIN` микросекунд активно ожидает дедлайн.
///
/// Возвращает:
/// - `true`  — дедлайн достигнут;
/// - `false` — поток получил сигнал остановки.
#[inline(always)]
fn wait_until(
    deadline: Instant,
    running: &AtomicBool,
    wake_state: &(Mutex<bool>, Condvar),
) -> bool {
    loop {
        // --------------------------------------------------------------------
        // Проверяем остановку.
        // --------------------------------------------------------------------

        if !running.load(Ordering::Acquire) {
            return false;
        }

        // --------------------------------------------------------------------
        // Проверяем дедлайн.
        // --------------------------------------------------------------------

        let now = Instant::now();

        if now >= deadline {
            return true;
        }

        let remaining = deadline.duration_since(now);

        // --------------------------------------------------------------------
        // Длинное ожидание.
        // --------------------------------------------------------------------

        if remaining > SPIN_MARGIN {
            let sleep_until = remaining - SPIN_MARGIN;

            let (lock, cvar) = wake_state;

            let mut wake = match lock.lock() {
                Ok(lock) => lock,
                Err(poisoned) => poisoned.into_inner(),
            };

            // Было досрочное пробуждение.
            //
            // Сбрасываем флаг и пересчитываем remaining.
            if *wake {
                *wake = false;
                continue;
            }

            // Condvar может проснуться:
            // - по timeout;
            // - по notify;
            // - спонтанно.
            //
            // Поэтому после возврата всегда начинаем цикл заново
            // и повторно проверяем deadline/running.
            let (wake, _) = match cvar.wait_timeout(
                wake,
                sleep_until,
            ) {
                Ok(result) => result,
                Err(poisoned) => poisoned.into_inner(),
            };

            if *wake {
                // Сигнал consumed.
                //
                // Не возвращаемся сразу — сначала проверяем
                // running/deadline в начале следующей итерации.
                //
                // Это также защищает от ложных/spurious wakeups.
            }

            continue;
        }

        // --------------------------------------------------------------------
        // Последние микросекунды — точный spin.
        // --------------------------------------------------------------------

        while Instant::now() < deadline {
            if !running.load(Ordering::Acquire) {
                return false;
            }

            std::hint::spin_loop();
        }

        return true;
    }
}

/// При уничтожении `CycleManager` останавливаем поток.
impl Drop for CycleManager {
    fn drop(&mut self) {
        self.shutdown();
    }
}