use crate::network::udp::UdpBuffered;
use arc_swap::ArcSwap;   // атомарная замена Arc<HashMap> без мьютексов (RCU стиль)
use std::{collections::HashMap, io, panic::{catch_unwind, AssertUnwindSafe}, sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
    Mutex,
}, thread, time::{Duration, Instant}};

// ============================================================================
// PLATFORM BACKEND (trait для унификации ожидания)
// ============================================================================

// WaitBackend абстрагирует механизм ожидания до deadline + возможность wake извне.
// Это позволяет на Linux использовать эффективное блокирование на epoll, а на других ОС — условную переменную.
trait WaitBackend: Send + Sync {
    fn wait_until(&self, deadline: Instant);
    fn wake(&self);
}

// ============================================================================
// LINUX / ANDROID: high‑precision wait with timerfd + eventfd + epoll
// ============================================================================

#[cfg(any(target_os = "linux", target_os = "android"))]
mod platform {
    use super::WaitBackend;

    use std::{
        io,
        mem,
        os::unix::io::RawFd,
        ptr,
        time::Instant,
    };

    // Реализация на основе timerfd (монотонный таймер) + eventfd (для пробуждения) + epoll (ждёт оба).
    // Преимущества: абсолютно точное пробуждение по таймеру, низкие накладные расходы,
    // возможность разбудить из другого потока через запись в eventfd.
    pub struct Backend {
        timer_fd: RawFd,
        event_fd: RawFd,
        epoll_fd: RawFd,
    }

    impl Backend {
        pub fn new() -> io::Result<Self> {
            unsafe {
                // Таймер с монотонным временем, неблокирующий, закрывать при exec
                let timer_fd = libc::timerfd_create(libc::CLOCK_MONOTONIC, libc::TFD_NONBLOCK | libc::TFD_CLOEXEC);
                if timer_fd < 0 {
                    return Err(io::Error::last_os_error());
                }

                // eventfd для пробуждения: начальное значение 0, неблокирующий, cloexec
                let event_fd = libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC);
                if event_fd < 0 {
                    libc::close(timer_fd);
                    return Err(io::Error::last_os_error());
                }

                // epoll дескриптор
                let epoll_fd = libc::epoll_create1(libc::EPOLL_CLOEXEC);
                if epoll_fd < 0 {
                    libc::close(timer_fd);
                    libc::close(event_fd);
                    return Err(io::Error::last_os_error());
                }

                // Добавляем timer_fd в epoll, user data = 1
                let mut ev = libc::epoll_event {
                    events: libc::EPOLLIN as u32,
                    u64: 1,
                };
                if libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_ADD, timer_fd, &mut ev) < 0 {
                    let err = io::Error::last_os_error();
                    libc::close(timer_fd);
                    libc::close(event_fd);
                    libc::close(epoll_fd);
                    return Err(err);
                }

                // Добавляем event_fd, user data = 2
                ev.u64 = 2;
                if libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_ADD, event_fd, &mut ev) < 0 {
                    let err = io::Error::last_os_error();
                    libc::close(timer_fd);
                    libc::close(event_fd);
                    libc::close(epoll_fd);
                    return Err(err);
                }

                Ok(Self { timer_fd, event_fd, epoll_fd })
            }
        }
    }

    impl WaitBackend for Backend {
        // Блокируется до наступления deadline или до вызова wake() из другого потока.
        // Алгоритм:
        // - Рассчитываем относительную задержку.
        // - Устанавливаем timerfd на эту задержку.
        // - epoll_wait на -1 (бесконечное ожидание). Проснёмся либо по таймеру, либо по eventfd.
        // - После пробуждения читаем timerfd или eventfd, чтобы сбросить состояние.
        fn wait_until(&self, deadline: Instant) {
            let now = Instant::now();
            if deadline <= now {
                return;
            }

            let dur = deadline - now;
            let spec = libc::itimerspec {
                it_interval: libc::timespec { tv_sec: 0, tv_nsec: 0 },
                it_value: libc::timespec {
                    tv_sec: dur.as_secs() as _,
                    tv_nsec: dur.subsec_nanos() as _,
                },
            };

            unsafe {
                libc::timerfd_settime(self.timer_fd, 0, &spec, ptr::null_mut());
                let mut events: [libc::epoll_event; 8] = mem::zeroed();
                let count = libc::epoll_wait(self.epoll_fd, events.as_mut_ptr(), events.len() as i32, -1);
                if count <= 0 {
                    return;
                }
                let mut buf: u64 = 0;
                for i in 0..count as usize {
                    match events[i].u64 {
                        1 => {
                            // таймер сработал – вычитываем, чтобы следующая установка работала
                            libc::read(self.timer_fd, &mut buf as *mut _ as *mut libc::c_void, mem::size_of::<u64>());
                        }
                        2 => {
                            // внешнее пробуждение – вычитываем eventfd
                            libc::read(self.event_fd, &mut buf as *mut _ as *mut libc::c_void, mem::size_of::<u64>());
                        }
                        _ => {}
                    }
                }
            }
        }

        // Пробуждение из другого потока: пишем 1 в eventfd.
        fn wake(&self) {
            let val: u64 = 1;
            unsafe {
                libc::write(self.event_fd, &val as *const _ as *const libc::c_void, mem::size_of::<u64>());
            }
        }
    }

    impl Drop for Backend {
        fn drop(&mut self) {
            unsafe {
                libc::close(self.timer_fd);
                libc::close(self.event_fd);
                libc::close(self.epoll_fd);
            }
        }
    }
}

// ============================================================================
// WINDOWS / MACOS FALLBACK: Condvar + Mutex
// ============================================================================
// Для Windows и macOS (и любых других) используем условную переменную с таймаутом.
// Минус: точность зависит от системного таймера (обычно ~1-10 мс), но для наших целей (20 мс) достаточно.
// Плюс: просто и без зависимостей от libc на Windows (мы не используем WinAPI таймеры с высоким разрешением,
// чтобы не усложнять код). При необходимости можно заменить на WaitableTimer, но Condvar проще и кроссплатформенно.
#[cfg(any(target_os = "windows", target_os = "macos"))]
mod platform {
    use super::WaitBackend;

    use std::{
        io,
        sync::{Condvar, Mutex},
        time::Instant,
    };

    pub struct Backend {
        state: Mutex<bool>, // фиктивное состояние, не используется, но нужно для Condvar::wait_timeout
        cvar: Condvar,
    }

    impl Backend {
        pub fn new() -> io::Result<Self> {
            Ok(Self {
                state: Mutex::new(false),
                cvar: Condvar::new(),
            })
        }
    }

    impl WaitBackend for Backend {
        // Ждём до deadline или до пробуждения.
        fn wait_until(&self, deadline: Instant) {
            let now = Instant::now();
            if deadline <= now {
                return;
            }
            let timeout = deadline - now;
            let guard = self.state.lock().unwrap();
            let _ = self.cvar.wait_timeout(guard, timeout);
            // При пробуждении (по таймауту или по wake) просто выходим.
        }

        // Пробуждение: посылаем сигнал condvar.
        fn wake(&self) {
            self.cvar.notify_one();
        }
    }
}

// ============================================================================
// UNSUPPORTED
// ============================================================================

#[cfg(not(any(target_os = "linux", target_os = "android", target_os = "windows", target_os = "macos")))]
compile_error!("Unsupported platform for CycleManager");

// ============================================================================
// CONFIG
// ============================================================================

const TICK_INTERVAL_MS: u64 = 20;      // период вызова tick() 20 мс (50 Гц)
const MAX_CATCH_UP_TICKS: u32 = 2;     // максимальное количество "догоняющих" тиков за одну итерацию
// (чтобы не уходить в бесконечный цикл при сильной задержке)

// ============================================================================
// CYCLE MANAGER
// ============================================================================

pub struct CycleManager {
    // Текущие сессии UdpBuffered, ключ — id.
    // Используем ArcSwap: это позволяет атомарно заменить весь HashMap без блокировок.
    // Читатели (поток CycleManager) получают snapshot -> Arc<HashMap>.
    // Писатели (add/remove) делают load_full + clone + modify + store.
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,

    // Флаг работы потока.
    running: Arc<AtomicBool>,

    // JoinHandle потока-цикла.
    handle: Mutex<Option<thread::JoinHandle<()>>>,

    // Бэкенд ожидания (платформозависимый).
    backend: Arc<platform::Backend>
}

impl CycleManager {
    // =========================================================================
    // NEW
    // =========================================================================

    pub fn new() -> io::Result<Self> {
        Ok(CycleManager {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            backend: Arc::new(platform::Backend::new()?)
        })
    }

    // =========================================================================
    // SESSIONS
    // =========================================================================

    // Добавить сессию. Если поток ещё не запущен – запускаем (lazy start).
    // После изменения карты – пробуждаем цикл, чтобы он пересчитал таймеры (необязательно, но безопасно).
    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        let mut map = self.sessions.load_full();      // клонируем Arc<HashMap>
        Arc::make_mut(&mut map).insert(id, session); // делаем мутабельную копию если нужно
        self.sessions.store(map);                    // атомарно заменяем указатель
        self.start_if_needed();
        self.backend.wake();                         // будим цикл, чтобы он не спал до следующего тика
    }

    /// Удаление сессии из цикла
    /// После удаления, поток может работать дальше если есть еще активные сессии
    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);
        self.backend.wake();
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    // Остановка цикла и ожидание завершения потока.
    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
        self.backend.wake();                    // прерываем ожидание
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    // =========================================================================
    // START
    // =========================================================================

    // Запускаем поток, если:
    // - running был false (compare_exchange успешен)
    // - handle ещё не установлен (защита от двойного старта)
    fn start_if_needed(&self) {
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return; // уже запущен
        }

        let mut guard = self.handle.lock().unwrap();
        if guard.is_some() {
            return;
        }

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);
        let backend = Arc::clone(&self.backend);

        let handle = thread::spawn(move || {
            let interval = Duration::from_millis(TICK_INTERVAL_MS);
            let mut next_tick = Instant::now() + interval;

            while running.load(Ordering::Acquire) {
                let now = Instant::now();

                // ---- catch-up logic ----
                // Если мы отстали от графика (now > next_tick), вычисляем количество пропущенных тиков.
                // Но не более MAX_CATCH_UP_TICKS, чтобы не зациклиться на долгое время.
                let mut ticks = 1;
                if now > next_tick {
                    let missed = ((now - next_tick).as_nanos() / interval.as_nanos()) as u32;
                    ticks += missed.min(MAX_CATCH_UP_TICKS);
                }

                // Вызываем tick() на всех сессиях нужное количество раз.
                // Используем snapshot (Arc<HashMap>) – данные не меняются во время итерации.
                let snapshot = sessions.load();
                if !snapshot.is_empty() {
                    for _ in 0..ticks {
                        for session in snapshot.values() {
                            // Защита от паники внутри tick() – одна сессия не должна валить весь цикл.
                            let _ = catch_unwind(AssertUnwindSafe(|| {
                                session.tick();
                            }));
                        }
                    }
                }

                // ---- drift correction ----
                // Корректируем next_tick.
                // Если отставание слишком большое (>4 интервалов), сбрасываем next_tick на текущее время + интервал.
                // Иначе просто прибавляем интервал (это предотвращает накопление ошибки).
                let now = Instant::now();
                if now > next_tick + interval * 4 {
                    next_tick = now + interval;
                } else {
                    next_tick += interval;
                }

                // Ждём до следующего запланированного тика (или пока не разбудят).
                backend.wait_until(next_tick);
            }
        });

        *guard = Some(handle);
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.backend.wake();
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}