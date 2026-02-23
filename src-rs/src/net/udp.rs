use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode, ErrorStrategy};
use napi_derive::napi;
use std::net::UdpSocket;
use std::thread;

#[napi]
pub struct UdpSender {
    socket: UdpSocket,
    addr: String,
}

#[napi]
impl UdpSender {
    #[napi(constructor)]
    pub fn new(remote_addr: String) -> Self {
        let socket = UdpSocket::bind("0.0.0.0:0").expect("Failed to bind UDP socket");
        Self { socket, addr: remote_addr }
    }

    #[napi]
    pub fn send_packet(&self, packet: Buffer) -> Result<()> {
        self.socket
            .send_to(packet.as_ref(), &self.addr)
            .map_err(|e| Error::new(Status::GenericFailure, format!("UDP send error: {}", e)))?;
        Ok(())
    }

    #[napi]
    pub fn start_listening(&self, callback: JsFunction) -> Result<()> {
        // Создаем канал связи с JS
        let tsfn: ThreadsafeFunction<Vec<u8>, ErrorStrategy::Fatal> = callback
            .create_threadsafe_function(0, |ctx| {
                ctx.env.create_buffer_with_data(ctx.value).map(|b| vec![b.into_unknown()])
            })?;

        let socket = self.socket.try_clone().map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;

        // Уходим в отдельный поток, чтобы не блокировать JS
        thread::spawn(move || {
            let mut buf = [0u8; 2048];
            loop {
                match socket.recv_from(&mut buf) {
                    Ok((size, _)) => {
                        let data = buf[..size].to_vec();
                        // Вызываем JS колбэк только когда есть данные
                        tsfn.call(data, ThreadsafeFunctionCallMode::Blocking);
                    }
                    Err(_) => break, // Выход при закрытии сокета
                }
            }
        });

        Ok(())
    }
}