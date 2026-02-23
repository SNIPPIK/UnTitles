use napi::bindgen_prelude::*;
use napi::threadsafe_function::{
    ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode,
};
use napi_derive::napi;
use once_cell::sync::Lazy;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

static WORKERS: Lazy<Mutex<HashMap<u32, Arc<CycleWorker>>>> =
    Lazy::new(|| Mutex::new(HashMap::new()));

static NEXT_ID: AtomicI32 = AtomicI32::new(1);

pub struct CycleWorker {
    target_interval_micros: AtomicI64,
    current_lag_micros: AtomicI32,
    running: AtomicBool,
    sync_pair: Arc<(Mutex<bool>, Condvar)>,
    handle: Mutex<Option<JoinHandle<()>>>,
}

impl CycleWorker {
    pub fn new(interval_ms: i32) -> Self {
        Self {
            target_interval_micros: AtomicI64::new((interval_ms * 1000) as i64),
            current_lag_micros: AtomicI32::new(0),
            running: AtomicBool::new(false),
            sync_pair: Arc::new((Mutex::new(false), Condvar::new())),
            handle: Mutex::new(None),
        }
    }
}

#[napi]
pub fn start_cycle(interval_ms: i32, cb: JsFunction) -> Result<u32> {
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed) as u32;
    let worker = Arc::new(CycleWorker::new(interval_ms));

    let tsfn: ThreadsafeFunction<f64, ErrorStrategy::Fatal> =
        cb.create_threadsafe_function(0, |ctx| {
            ctx.env.create_double(ctx.value).map(|v| vec![v])
        })?;

    worker.running.store(true, Ordering::Release);

    let worker_clone = Arc::clone(&worker);

    let handle = thread::spawn(move || {
        let start_time = Instant::now();
        let mut last_tick = start_time;
        let mut drift_micros: i64 = 0;

        while worker_clone.running.load(Ordering::Acquire) {
            let target = worker_clone
                .target_interval_micros
                .load(Ordering::Relaxed);

            let lag = worker_clone
                .current_lag_micros
                .load(Ordering::Relaxed) as i64;

            let mut adjusted = target - drift_micros - lag;
            if adjusted < 0 {
                adjusted = 0;
            }

            let next_tick = last_tick + Duration::from_micros(adjusted as u64);

            // --- Condvar sleep (до 500µs)
            let (lock, cvar) = &*worker_clone.sync_pair;
            let guard = lock.lock().unwrap();

            let wait = next_tick.saturating_duration_since(Instant::now());
            let sleep_part = wait.saturating_sub(Duration::from_micros(500));

            if sleep_part > Duration::ZERO {
                let _ = cvar.wait_timeout(guard, sleep_part).unwrap();
            }

            // --- Spin phase (последние ~500µs)
            while worker_clone.running.load(Ordering::Acquire) {
                let now = Instant::now();
                if now >= next_tick {
                    break;
                }
                std::hint::spin_loop();
            }

            if !worker_clone.running.load(Ordering::Acquire) {
                break;
            }

            let now = Instant::now();
            let elapsed_ms =
                now.duration_since(start_time).as_secs_f64();

            tsfn.call(elapsed_ms, ThreadsafeFunctionCallMode::NonBlocking);

            // --- Drift compensation
            let actual = now.duration_since(last_tick).as_micros() as i64;
            drift_micros = actual - target;

            let max_drift = target;
            drift_micros = drift_micros.clamp(-max_drift, max_drift);

            last_tick = now;
        }

        if let Err(e) = tsfn.abort() {
            eprintln!("TSFN abort error: {:?}", e);
        }
    });

    *worker.handle.lock().unwrap() = Some(handle);

    WORKERS.lock().unwrap().insert(id, worker);

    Ok(id)
}

#[napi]
pub fn stop_cycle(id: u32) {
    if let Some(worker) = WORKERS.lock().unwrap().remove(&id) {
        worker.running.store(false, Ordering::Release);

        let (_, cvar) = &*worker.sync_pair;
        cvar.notify_all();

        if let Some(handle) = worker.handle.lock().unwrap().take() {
            let _ = handle.join();
        }
    }
}

#[napi]
pub fn set_lag(id: u32, lag_micros: i32) {
    if let Some(worker) = WORKERS.lock().unwrap().get(&id) {
        let target = worker
            .target_interval_micros
            .load(Ordering::Relaxed) as i32;

        worker.current_lag_micros.store(
            lag_micros.clamp(0, target),
            Ordering::Relaxed,
        );
    }
}

#[napi]
pub fn set_step_interval(id: u32, interval_micros: i64) {
    if let Some(worker) = WORKERS.lock().unwrap().get(&id) {
        if interval_micros > 0 {
            worker
                .target_interval_micros
                .store(interval_micros, Ordering::Relaxed);
        }
    }
}