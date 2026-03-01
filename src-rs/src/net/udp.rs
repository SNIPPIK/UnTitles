use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi_derive::napi;

use std::{
    collections::VecDeque,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use crate::timers::cycle::{add_global_session, remove_global_session};

const MAX_BUFFER_ITEMS: usize = 1024 * 32;

/// Внутренние данные UDP с буфером и статистикой
pub struct UdpBufferedInner {
    pub socket: Arc<UdpSocket>,
    pub buffer: Mutex<VecDeque<Vec<u8>>>,
    pub send_drops: AtomicUsize,
}

impl UdpBufferedInner {
    pub fn push(&self, data: Vec<u8>) {
        let mut buf = self.buffer.lock().unwrap();

        // Если audio frame пуст
        if buf.is_empty() || buf.len() < 10 {
            return;
        }

        else if buf.len() >= MAX_BUFFER_ITEMS {
            buf.pop_front(); // теряем старый пакет
            self.send_drops.fetch_add(1, Ordering::Relaxed);
        }

        buf.push_back(data);
    }

    /// Попытка отправки одного пакета; при WouldBlock возвращает пакет в начало
    pub fn tick(&self) {
        if let Ok(mut buf) = self.buffer.try_lock() {
            if let Some(data) = buf.pop_front() {
                match self.socket.send(&data) {
                    Ok(_) => {}
                    Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        buf.push_front(data); // повторная попытка
                        self.send_drops.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(_) => {
                        self.send_drops.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
    }
}

#[napi(js_name = "UDPSocket")]
#[derive(Clone)]
pub struct UdpBuffered {
    inner: Arc<UdpBufferedInner>,
    listener_active: Arc<AtomicBool>,
    listener_handle: Arc<Mutex<Option<thread::JoinHandle<()>>>>,
    destroyed: Arc<AtomicBool>,
    id: u32,
}

#[napi]
impl UdpBuffered {
    #[napi(constructor)]
    pub fn new(remote_addr: String) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0")
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        socket
            .connect(&remote_addr)
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        socket.set_nonblocking(true).ok();

        let inner = Arc::new(UdpBufferedInner {
            socket: Arc::new(socket),
            buffer: Mutex::new(VecDeque::with_capacity(128)),
            send_drops: AtomicUsize::new(0),
        });

        let id = rand::random::<u32>();

        let udp = Self {
            inner,
            listener_active: Arc::new(AtomicBool::new(false)),
            listener_handle: Arc::new(Mutex::new(None)),
            destroyed: Arc::new(AtomicBool::new(false)),
            id,
        };

        add_global_session(id, Arc::new(udp.clone_for_manager()));

        Ok(udp)
    }

    #[napi]
    pub fn push_packet(&self, packet: Buffer) {
        if !packet.is_empty() {
            self.inner.push(packet.as_ref().to_vec());
        }
    }

    /// Начинаем слушать входящий поток
    #[napi]
    pub fn start_listening(&self, callback: JsFunction) -> Result<()> {
        if self.listener_active.load(Ordering::SeqCst) {
            return Ok(());
        }

        self.listener_active.store(true, Ordering::SeqCst);

        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> =
            callback.create_threadsafe_function(0, |ctx| {
                ctx.env
                    .create_buffer_with_data(ctx.value)
                    .map(|b| vec![b.into_unknown()])
            })?;

        let socket = self.inner.socket.clone();
        let active = self.listener_active.clone();

        thread::spawn(move || {
            let mut buf = [0u8; 2048];

            while active.load(Ordering::SeqCst) {
                match socket.recv(&mut buf) {
                    Ok(size) if size > 0 => {
                        let data = buf[..size].to_vec();
                        let _ = tsfn.call(data, ThreadsafeFunctionCallMode::Blocking);
                    }
                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(_) => break,
                    _ => {}
                }
            }

            let _ = tsfn.abort();
        });

        Ok(())
    }

    #[napi]
    pub fn stop_listening(&self) {
        self.listener_active.store(false, Ordering::Release);

        if let Some(handle) = self.listener_handle.lock().unwrap().take() {
            let _ = handle.join(); // дожидаемся завершения потока
        }
    }

    #[napi]
    pub fn destroy(&self) {
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        self.stop_listening();
        self.inner.buffer.lock().unwrap().clear();
        remove_global_session(self.id);
    }

    fn clone_for_manager(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            listener_active: self.listener_active.clone(),
            listener_handle: Arc::new(Mutex::new(None)),
            destroyed: self.destroyed.clone(),
            id: self.id,
        }
    }

    #[napi]
    pub fn tick(&self) {
        self.inner.tick();
    }

    #[napi(getter)]
    pub fn drops(&self) -> u32 {
        self.inner.send_drops.load(Ordering::Relaxed) as u32
    }
}

impl Drop for UdpBuffered {
    fn drop(&mut self) {
        self.destroy();
    }
}