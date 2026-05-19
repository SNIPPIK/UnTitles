use crate::network::udp::UdpBuffered;
use arc_swap::ArcSwap;   // атомарная замена Arc<HashMap> без блокировок

use std::{
    collections::HashMap,
    io,
    panic::{catch_unwind, AssertUnwindSafe},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};

// ============================================================================
// PLATFORM (Linux / Android)
// ============================================================================

#[cfg(any(target_os = "linux", target_os = "android"))]
mod platform {
    use std::{
        io,
        mem,
        os::unix::io::RawFd,
        ptr,
        time::Instant,
    };

    // Объект ожидания: таймер + событие (для пробуждения) + epoll, который ждёт оба.
    pub struct WaitObject {
        timer_fd: RawFd,
        event_fd: RawFd,
        epoll_fd: RawFd,
    }

    // Хэндл для внешнего пробуждения из других потоков (через eventfd).
    pub struct WakeHandle {
        event_fd: RawFd,
    }

    impl WakeHandle {
        #[inline]
        pub fn wake(&self) {
            let val: u64 = 1;
            // пишем 1 в eventfd – epoll выйдет из ожидания
            unsafe {
                libc::write(
                    self.event_fd,
                    &val as *const _ as *const libc::c_void,
                    mem::size_of::<u64>(),
                );
            }
        }
    }

    // Создаём таймер и eventfd, добавляем оба в epoll.
    // Возвращает (WaitObject, WakeHandle). WaitObject остаётся в управляющем потоке.
    pub fn create_timer() -> io::Result<(WaitObject, WakeHandle)> {
        unsafe {
            let timer_fd = libc::timerfd_create(
                libc::CLOCK_MONOTONIC,
                libc::TFD_NONBLOCK | libc::TFD_CLOEXEC,
            );
            if timer_fd < 0 {
                return Err(io::Error::last_os_error());
            }

            let event_fd = libc::eventfd(0, libc::EFD_NONBLOCK | libc::EFD_CLOEXEC);
            if event_fd < 0 {
                libc::close(timer_fd);
                return Err(io::Error::last_os_error());
            }

            let epoll_fd = libc::epoll_create1(libc::EPOLL_CLOEXEC);
            if epoll_fd < 0 {
                libc::close(timer_fd);
                libc::close(event_fd);
                return Err(io::Error::last_os_error());
            }

            // регистрируем timer_fd с user data = 1
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

            // регистрируем event_fd с user data = 2
            ev.u64 = 2;
            if libc::epoll_ctl(epoll_fd, libc::EPOLL_CTL_ADD, event_fd, &mut ev) < 0 {
                let err = io::Error::last_os_error();
                libc::close(timer_fd);
                libc::close(event_fd);
                libc::close(epoll_fd);
                return Err(err);
            }

            Ok((
                WaitObject { timer_fd, event_fd, epoll_fd },
                WakeHandle { event_fd },
            ))
        }
    }

    impl WaitObject {
        // Ждать до абсолютного момента `deadline`. Если deadline уже прошёл – сразу выходим.
        // Устанавливаем таймер, epoll_wait с бесконечным ожиданием, обрабатываем события.
        #[inline]
        pub fn wait_until(&self, deadline: Instant) {
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
                            // таймер сработал – читаем, чтобы сбросить состояние
                            libc::read(self.timer_fd, &mut buf as *mut _ as *mut libc::c_void, mem::size_of::<u64>());
                        }
                        2 => {
                            // внешний wake – читаем eventfd
                            libc::read(self.event_fd, &mut buf as *mut _ as *mut libc::c_void, mem::size_of::<u64>());
                        }
                        _ => {}
                    }
                }
            }
        }
    }

    impl Drop for WaitObject {
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
// PLATFORM (macOS) – используем kqueue
// ============================================================================

#[cfg(target_os = "macos")]
mod platform {
    use std::io;
    use std::os::unix::io::RawFd;
    use std::time::Instant;

    pub struct WaitObject {
        kq: RawFd,
        timer_ident: usize,
        wake_ident: usize,
    }

    pub struct WakeHandle {
        kq: RawFd,
        wake_ident: usize,
    }

    impl WakeHandle {
        pub fn wake(&self) {
            // триггерим событие EVFILT_USER
            let kev = libc::kevent {
                ident: self.wake_ident,
                filter: libc::EVFILT_USER,
                flags: 0,
                fflags: libc::NOTE_TRIGGER,
                data: 0,
                udata: std::ptr::null_mut(),
            };
            unsafe { libc::kevent(self.kq, &kev, 1, std::ptr::null_mut(), 0, std::ptr::null()); }
        }
    }

    pub fn create_timer() -> io::Result<(WaitObject, WakeHandle)> {
        let kq = unsafe { libc::kqueue() };
        if kq < 0 {
            return Err(io::Error::last_os_error());
        }
        let timer_ident = 1;
        let wake_ident = 2;

        // добавляем пользовательское событие для wake
        let kev = libc::kevent {
            ident: wake_ident,
            filter: libc::EVFILT_USER,
            flags: libc::EV_ADD | libc::EV_CLEAR,
            fflags: 0,
            data: 0,
            udata: std::ptr::null_mut(),
        };
        if unsafe { libc::kevent(kq, &kev, 1, std::ptr::null_mut(), 0, std::ptr::null()) } < 0 {
            let err = io::Error::last_os_error();
            unsafe { libc::close(kq); }
            return Err(err);
        }

        Ok((WaitObject { kq, timer_ident, wake_ident }, WakeHandle { kq, wake_ident }))
    }

    impl WaitObject {
        // macOS не имеет таймера с абсолютным временем напрямую, но можно использовать EVFILT_TIMER с NOTE_ABSOLUTE.
        // Получаем текущее время в тиках mach_absolute_time, конвертируем deadline в тики.
        pub fn wait_until(&self, deadline: Instant) {
            let now = Instant::now();
            if deadline <= now {
                return;
            }
            let diff = deadline - now;

            let now_abs = unsafe { libc::mach_absolute_time() };
            let mut info: libc::mach_timebase_info = unsafe { std::mem::zeroed() };
            unsafe { libc::mach_timebase_info(&mut info) };
            let nanos = diff.as_nanos() as u64;
            let ticks = nanos
                .checked_mul(info.denom as u64)
                .map(|v| v / info.numer as u64)
                .unwrap_or(0);
            let deadline_abs = now_abs.saturating_add(ticks);

            let kev = libc::kevent {
                ident: self.timer_ident,
                filter: libc::EVFILT_TIMER,
                flags: libc::EV_ADD | libc::EV_ONESHOT,
                fflags: libc::NOTE_ABSOLUTE,
                data: deadline_abs as i64,
                udata: std::ptr::null_mut(),
            };
            let mut out: [libc::kevent; 1] = [libc::kevent {
                ident: 0,
                filter: 0,
                flags: 0,
                fflags: 0,
                data: 0,
                udata: std::ptr::null_mut(),
            }];
            // kevent с таймером блокирует до срабатывания таймера или wake
            unsafe { libc::kevent(self.kq, &kev, 1, out.as_mut_ptr(), 1, std::ptr::null()); }
        }
    }

    impl Drop for WaitObject {
        fn drop(&mut self) {
            unsafe { libc::close(self.kq); }
        }
    }
}

// ============================================================================
// PLATFORM (Windows)
// ============================================================================

#[cfg(target_os = "windows")]
mod platform {
    use std::io;
    use std::time::Instant;
    use windows_sys::Win32::System::Threading::{
        CreateWaitableTimerExW, SetWaitableTimer, WaitForMultipleObjects,
        CreateEventW, SetEvent, CloseHandle, WAIT_OBJECT_0, INFINITE,
    };
    use windows_sys::Win32::Foundation::HANDLE;

    pub struct WaitObject {
        timer_handle: HANDLE,
        event_handle: HANDLE,
    }

    pub struct WakeHandle {
        event_handle: HANDLE,
    }

    impl WakeHandle {
        pub fn wake(&self) {
            unsafe { SetEvent(self.event_handle); }
        }
    }

    pub fn create_timer() -> io::Result<(WaitObject, WakeHandle)> {
        let timer_handle = unsafe {
            CreateWaitableTimerExW(
                std::ptr::null_mut(),
                std::ptr::null_mut(),
                0,
                TIMER_ALL_ACCESS,
            )
        };
        if timer_handle.is_null() {
            return Err(io::Error::last_os_error());
        }
        let event_handle = unsafe { CreateEventW(std::ptr::null_mut(), 0, 0, std::ptr::null()) };
        if event_handle.is_null() {
            unsafe { CloseHandle(timer_handle); }
            return Err(io::Error::last_os_error());
        }
        Ok((WaitObject { timer_handle, event_handle }, WakeHandle { event_handle }))
    }

    impl WaitObject {
        // Windows: таймер с относительным временем в 100-наносекундных интервалах (отрицательное значение).
        // WaitForMultipleObjects ждёт два объекта: таймер и событие.
        pub fn wait_until(&self, deadline: Instant) {
            let now = Instant::now();
            if deadline <= now {
                return;
            }
            let delay = deadline - now;
            // 100 ns единицы: 1 tick = 100 ns, переводим наносекунды в 100 нс и делаем отрицательным
            let due_time = -((delay.as_nanos() / 100) as i64);
            unsafe {
                SetWaitableTimer(
                    self.timer_handle,
                    &mut (due_time as i64),
                    0,
                    None,
                    std::ptr::null_mut(),
                    0,
                );
                let handles = [self.timer_handle, self.event_handle];
                WaitForMultipleObjects(2, handles.as_ptr(), 0, INFINITE);
            }
        }
    }

    impl Drop for WaitObject {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.timer_handle);
                CloseHandle(self.event_handle);
            }
        }
    }

    impl Drop for WakeHandle {
        fn drop(&mut self) {
            unsafe { CloseHandle(self.event_handle); }
        }
    }
}

// ============================================================================
// CYCLE MANAGER
// ============================================================================

const TICK_INTERVAL_MS: u64 = 20;          // 20 мс = 50 тиков в секунду
const MAX_CATCH_UP_TICKS: u32 = 2;         // максимальное число "догоняющих" тиков за один раз

/// Управляет циклом вызова `tick()` для всех UdpBuffered сессий.
/// Особенности:
/// - Запускает поток только когда есть хотя бы одна сессия (lazy start).
/// - При добавлении/удалении сессии – пробуждает поток, чтобы он пересмотрел таймер.
/// - Использует ArcSwap для хранения HashMap – атомарная замена без RWLock.
/// - При большом отставании (now > next_tick) делает catch-up, но не более MAX_CATCH_UP_TICKS,
///   чтобы не блокировать другие задачи.
/// - Вызовы item.tick() защищены catch_unwind – паника в одной сессии не убивает весь цикл.
pub struct CycleManager {
    sessions: Arc<ArcSwap<HashMap<u32, Arc<UdpBuffered>>>>,
    running: Arc<AtomicBool>,
    handle: Mutex<Option<thread::JoinHandle<()>>>,
    wake_handle: Mutex<platform::WakeHandle>,
    wait_obj: Mutex<Option<platform::WaitObject>>,
}

impl CycleManager {
    // =========================================================================
    // NEW
    // =========================================================================

    pub fn new() -> io::Result<Self> {
        let (wait_obj, wake_handle) = platform::create_timer()?;
        Ok(Self {
            sessions: Arc::new(ArcSwap::from_pointee(HashMap::new())),
            running: Arc::new(AtomicBool::new(false)),
            handle: Mutex::new(None),
            wake_handle: Mutex::new(wake_handle),
            wait_obj: Mutex::new(Some(wait_obj)),
        })
    }

    // =========================================================================
    // SESSION MANAGEMENT
    // =========================================================================

    pub fn add_session(&self, id: u32, session: Arc<UdpBuffered>) {
        let mut map = self.sessions.load_full();            // клонируем Arc<HashMap>
        Arc::make_mut(&mut map).insert(id, session);        // делаем уникальным, если нужно
        self.sessions.store(map);                           // атомарно заменяем
        self.start_if_needed();
        // Пробуждаем цикл, чтобы он не спал до следующего tick (может быть, нужно обработать сразу)
        self.wake_handle.lock().unwrap().wake();
    }

    pub fn remove_session(&self, id: u32) {
        let mut map = self.sessions.load_full();
        Arc::make_mut(&mut map).remove(&id);
        self.sessions.store(map);
        self.wake_handle.lock().unwrap().wake();
    }

    // =========================================================================
    // SHUTDOWN
    // =========================================================================

    pub fn shutdown(&self) {
        self.running.store(false, Ordering::Release);
        self.wake_handle.lock().unwrap().wake();
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }

    // =========================================================================
    // START
    // =========================================================================

    // Запускает поток, если ещё не запущен и есть сессии.
    // Использует compare_exchange для запуска только один раз.
    fn start_if_needed(&self) {
        if self.running.compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire).is_err() {
            return; // уже запущен
        }

        let mut handle_guard = self.handle.lock().unwrap();
        if handle_guard.is_some() {
            return; // на всякий случай
        }

        // Забираем wait_obj из Mutex (Option::take). Если его там нет – создаём заново.
        let wait_obj = {
            let mut guard = self.wait_obj.lock().unwrap();
            guard.take().unwrap_or_else(|| {
                let (wo, wh) = platform::create_timer().expect("failed to recreate timer");
                *self.wake_handle.lock().unwrap() = wh;
                wo
            })
        };

        let sessions = Arc::clone(&self.sessions);
        let running = Arc::clone(&self.running);

        let handle = thread::spawn(move || {
            let interval = Duration::from_millis(TICK_INTERVAL_MS);
            let mut next_tick = Instant::now() + interval;

            while running.load(Ordering::Acquire) {
                let now = Instant::now();

                // Определяем, сколько тиков нужно «догнать», если мы отстали.
                // Но не более MAX_CATCH_UP_TICKS, чтобы не зациклиться на долго.
                let mut ticks = 1;
                if now > next_tick {
                    let missed = ((now - next_tick).as_nanos() / interval.as_nanos()) as u32;
                    ticks += missed.min(MAX_CATCH_UP_TICKS);
                }

                let snapshot = sessions.load(); // Arc<HashMap>
                if !snapshot.is_empty() {
                    for _ in 0..ticks {
                        for item in snapshot.values() {
                            // Защита от паники в пользовательском коде (например, сетевой ошибке внутри tick)
                            let _ = catch_unwind(AssertUnwindSafe(|| {
                                item.tick();
                            }));
                        }
                    }
                }

                // Жёсткое перевыравнивание: следующий ожидаемый тик всегда от текущего момента + интервал.
                // Это предотвращает накопление дрейфа.
                next_tick = Instant::now() + interval;

                // Ждём до следующего дедлайна (или пока не разбудят через wake)
                wait_obj.wait_until(next_tick);
            }
        });

        *handle_guard = Some(handle);
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for CycleManager {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Release);
        self.wake_handle.lock().unwrap().wake();
        if let Some(handle) = self.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}