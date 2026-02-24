use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ErrorStrategy, ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;
use std::sync::atomic::{AtomicBool, AtomicI32, AtomicI64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

#[napi(js_name = "CycleWorker")]
pub struct CycleWorker {
    target_interval_micros: Arc<AtomicI64>,
    current_lag_micros: Arc<AtomicI32>,
    running: Arc<AtomicBool>,
    handle: Arc<Mutex<Option<JoinHandle<()>>>>,
}

#[napi]
impl CycleWorker {
    #[napi(constructor)]
    pub fn new(interval_ms: i32) -> Self {
        Self {
            target_interval_micros: Arc::new(AtomicI64::new((interval_ms * 1000) as i64)),
            current_lag_micros: Arc::new(AtomicI32::new(0)),
            running: Arc::new(AtomicBool::new(false)),
            handle: Arc::new(Mutex::new(None)),
        }
    }

    #[napi]
    pub fn start(&self, cb: JsFunction) -> Result<()> {
        // Если уже запущен — ничего не делаем
        if self.running.load(Ordering::Acquire) {
            return Ok(());
        }

        let tsfn: ThreadsafeFunction<f64, ErrorStrategy::Fatal> =
            cb.create_threadsafe_function(0, |ctx| ctx.env.create_double(ctx.value).map(|v| vec![v]))?;

        self.running.store(true, Ordering::Release);

        // Клонируем атомики только для этого потока
        let running = Arc::clone(&self.running);
        let interval = Arc::clone(&self.target_interval_micros);
        let lag = Arc::clone(&self.current_lag_micros);

        // Остановим старый поток, если есть
        if let Ok(mut h) = self.handle.lock() {
            if let Some(join_handle) = h.take() {
                running.store(false, Ordering::Release);
                let _ = join_handle.join();
            }
        }

        let handle = thread::spawn(move || {
            let start_time = Instant::now();
            let mut tick_counter: u64 = 0;

            while running.load(Ordering::Acquire) {
                tick_counter += 1;
                let interval_us = interval.load(Ordering::Relaxed) as u64;
                let ideal_tick = start_time + Duration::from_micros(tick_counter * interval_us);

                let lag_us = lag.load(Ordering::Relaxed) as u64;
                let target = ideal_tick.checked_sub(Duration::from_micros(lag_us)).unwrap_or(ideal_tick);

                loop {
                    let now = Instant::now();
                    if now >= target {
                        break;
                    }
                    let diff = target - now;
                    if diff > Duration::from_micros(200) {
                        thread::sleep(Duration::from_micros(100));
                    } else {
                        std::hint::spin_loop();
                    }
                    if !running.load(Ordering::Acquire) {
                        return;
                    }
                }

                let _ = tsfn.call(
                    Instant::now().duration_since(start_time).as_secs_f64() * 1000.0,
                    ThreadsafeFunctionCallMode::NonBlocking,
                );
            }

            let _ = tsfn.abort();
        });

        *self.handle.lock().unwrap() = Some(handle);

        Ok(())
    }

    #[napi]
    pub fn stop(&self) -> Result<()> {
        self.running.store(false, Ordering::Release);

        if let Ok(mut h) = self.handle.lock() {
            if let Some(join_handle) = h.take() {
                let _ = join_handle.join();
            }
        }

        Ok(())
    }

    #[napi]
    pub fn set_lag(&self, lag_micros: i32) {
        let target = self.target_interval_micros.load(Ordering::Relaxed) as i32;
        self.current_lag_micros.store(lag_micros.clamp(0, target), Ordering::Relaxed);
    }
}