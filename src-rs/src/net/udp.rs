use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi_derive::napi;

use std::{
    collections::VecDeque,
    net::UdpSocket,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::Duration,
};

use crate::timers::cycle::GLOBAL_MANAGER;

const MAX_BUFFER: usize = 1024 * 32;

pub struct UdpBufferedInner {
    pub socket: Arc<UdpSocket>,
    pub buffer: Mutex<VecDeque<Vec<u8>>>,
}

impl UdpBufferedInner {
    /// Добавление аудио пакета в буфер
    pub fn push(&self, data: Vec<u8>) {
        let mut buf = self.buffer.lock().unwrap();
        buf.push_back(data);

        // Если буфер достиг лимита
        if buf.len() > MAX_BUFFER {
            buf.pop_front();
        }
    }

    /// Отправка аудио в endpoint по UDP
    pub fn tick(&self) {
        if let Some(data) = self.buffer.lock().unwrap().pop_front() {
            let _ = self.socket.send(&data);
        }
    }
}


#[napi(js_name = "UDPSocket")]
#[derive(Clone)]
pub struct UdpBuffered {
    inner: Arc<UdpBufferedInner>,
    listener_active: Arc<AtomicBool>,
    id: u32,
}

#[napi]
impl UdpBuffered {
    #[napi(constructor)]
    pub fn new(remote_addr: String) -> Result<Self> {
        let socket = UdpSocket::bind("0.0.0.0:0").map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        socket.connect(&remote_addr).map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        socket.set_nonblocking(true).ok();

        let inner = Arc::new(UdpBufferedInner {
            socket: Arc::new(socket),
            buffer: Mutex::new(VecDeque::with_capacity(128)),
        });

        let id = rand::random::<u32>();

        let udp = Self {
            inner: inner.clone(),
            listener_active: Arc::new(AtomicBool::new(false)),
            id,
        };

        // Добавляем UDP сессию в Cycle
        GLOBAL_MANAGER.add_session(id, Arc::new(udp.clone_for_manager()));

        Ok(udp)
    }

    /// Добавляем аудио пакет для последующей отправки
    #[napi]
    pub fn push_packet(&self, packet: Buffer) {
        if packet.is_empty() {
            return;
        }

        self.inner.push(packet.to_vec());
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

    /// Останавливаем слушателя входящего потока
    #[napi]
    pub fn stop_listening(&self) {
        self.listener_active.store(false, Ordering::SeqCst);
    }

    /// Удаляем все зависимости
    #[napi]
    pub fn destroy(&self) {
        // останавливаем listener
        self.stop_listening();

        // очищаем буфер
        self.inner.buffer.lock().unwrap().clear();

        // удаляем из глобального менеджера
        GLOBAL_MANAGER.remove_session(self.id);
    }

    fn clone_for_manager(&self) -> Self {
        Self {
            inner: self.inner.clone(),
            listener_active: self.listener_active.clone(),
            id: self.id,
        }
    }

    pub fn tick(&self) {
        self.inner.tick();
    }
}