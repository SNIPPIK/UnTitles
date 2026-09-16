use crate::structures::{
    audio::ring_buffer::RingBuffer,
    crypto::aes::VoiceRTPSocket
};
use std::{
    io::ErrorKind,
    net::UdpSocket,
    sync::{
        atomic::{AtomicU32, AtomicU64, AtomicUsize, Ordering},
        Arc,
    }
};

/// Время до отправки keepalive пакета, для работы поверх NAT систем
const KEEP_ALIVE_INTERVAL: u64 = 10000;

/// Keepalive — 8 байт: LE u32 counter + 4 байта нулей.
/// Отправляется как есть, без RTP-обёртки и без шифрования.
const KEEPALIVE_SIZE: usize = 8;

/// Discovery — 74 байта: готовый UDP-пакет Discord.
/// Отправляется как есть, без RTP-обёртки и без шифрования.
const DISCOVERY_SIZE: usize = 74;

/// Готовые не-RTP пакеты, которые не шифруются и не оборачиваются в RTP.
/// Всё остальное считается Opus-фреймом и идёт через `VoiceRTPSocket`.
const RAW_BYPASS_SIZES: &[usize] = &[DISCOVERY_SIZE];

/// Проверяет, должен ли фрейм отправляться сырым, без RTP-шифрования.
///
/// # Аргументы
/// * `frame_len` — длина фрейма в байтах.
///
/// # Возвращаемое значение
/// `true`, если размер фрейма входит в список исключений.
#[inline]
fn is_raw_bypass(frame_len: usize) -> bool {
    RAW_BYPASS_SIZES.contains(&frame_len)
}


/// Внутренние данные UDP-сокета с буфером исходящих пакетов и статистикой.
///
/// Хранит сам сокет (в Arc для разделения между несколькими экземплярами UdpBuffered,
/// которые могут быть клонированы для менеджера), очередь пакетов и счётчик сброшенных
/// пакетов (drops). Все методы работают с блокировкой очереди, но стараются минимизировать
/// время удержания блокировки.
pub struct SocketInner {
    /// RTP-шифратор для аудио-фреймов.
    pub rtp: VoiceRTPSocket,

    /// Сокет UDP, обёрнутый в Arc для возможности разделения.
    pub socket: Arc<UdpSocket>,

    /// Очередь исходящих пакетов. Защищена мьютексом, так как используется из нескольких
    /// потоков: основной поток добавляет пакеты через push, а цикл тиков (в CycleManager)
    /// вызывает tick для отправки.
    pub buffer: RingBuffer,

    /// Счётчик количества пакетов, которые не были отправлены из-за переполнения буфера
    /// или временной недоступности сокета (WouldBlock). Атомарный для потокобезопасности
    /// без блокировок.
    pub send_drops: AtomicUsize,

    /// Последнее зафиксированное время отправки пакета
    pub last_send_ms: AtomicU64,

    /// Монотонный id keepalive-пакетов (идёт в первые 4 байта LE).
    pub keepalive_counter: AtomicU32,

    /// Подряд идущие неудачи в `tick` (backoff/reconnect).
    pub consecutive_failures: AtomicU32
}

impl SocketInner {
    /// Добавляет пакет в очередь на отправку.
    ///
    /// # Аргументы
    /// * `data` — байтовые данные пакета.
    ///
    /// # Поведение
    /// Пустые данные игнорируются. При переполнении буфера в отладочной сборке
    /// выводится сообщение об ошибке.
    pub fn push(&self, data: Vec<u8>) {
        let _ = self.buffer.push(data);
    }

    /// Добавляет массив пакетов в очередь на отправку.
    ///
    /// # Аргументы
    /// * `packets` — вектор байтовых пакетов для добавления.
    pub fn push_many(&self, packets: Vec<Vec<u8>>) {
        // Делегируем массовое добавление во внутренний буфер.
        self.buffer.push_many(packets);
    }

    /// Проверка, есть ли ещё данные в кольцевом буфере.
    ///
    /// Возвращает `true`, если очередь содержит хотя бы один пакет,
    /// ожидающий отправки.
    pub fn has_pending_packets(&self) -> bool {
        !self.buffer.is_empty()
    }

    /// Определяет, что нужно отправить: пакет из очереди или keepalive-сигнал.
    ///
    /// Вызывается циклически из глобального менеджера с текущим временем в миллисекундах.
    /// Если в очереди есть пакеты, отправляет их (внутренний `tick` также обновляет таймер keepalive).
    /// Иначе проверяет, не пора ли отправить keepalive (если с последней отправки прошло
    /// больше `KEEP_ALIVE_INTERVAL`).
    pub fn auto_tick(&self, now: u64, budget: u8) {

        // Проверяем, есть ли пакеты, ожидающие отправки.
        if self.has_pending_packets() {
            // Отправляем накопленные пакеты (внутри также сбрасывается таймер keepalive).
            self.tick(now, budget);
        } else {
            // Если пакетов нет, проверяем время последней отправки.
            let last_ms = self.last_send_ms.load(Ordering::Relaxed);

            // Если прошло достаточно времени, отправляем keepalive.
            if now.saturating_sub(last_ms) >= KEEP_ALIVE_INTERVAL {
                self.tick_alive(now);
            }
        }
    }

    /// Попытка отправить один пакет из очереди.
    ///
    /// Вызывается из тика CycleManager. Пытается захватить блокировку очереди без ожидания
    /// (try_lock), чтобы не блокировать цикл, если очередь занята другим потоком.
    /// Если отправка завершается ошибкой WouldBlock (сокет временно недоступен),
    /// пакет возвращается в начало очереди (push_front) для повторной попытки позже,
    /// и счётчик drops увеличивается. Любая другая ошибка также приводит к возврату пакета.
    /// Попытка отправить один пакет из очереди.
    ///
    /// Discovery (74 байта) уходит сырым — без RTP и без шифрования,
    /// счётчики RTP при этом не двигаются.
    /// Всё остальное считается Opus-фреймом и шифруется в RTP.
    #[inline]
    fn tick(&self, now: u64, budget: u8) {
        // До инициализации RTP отправляем только discovery:
        // Opus-фреймы ждут ключа, discovery — нет.
        //
        // budget определяет максимальное количество элементов,
        // которое scheduler разрешил обработать за этот цикл.
        //
        // ВАЖНО:
        // budget != гарантированное количество отправленных пакетов.
        //
        // Это только верхняя граница:
        //
        //     budget = 3
        //     queue = 1 packet
        //
        //     -> отправим только 1.
        //
        // Поэтому scheduler не заставляет UDP отправлять несуществующие
        // или ещё не готовые данные.
        for _ in 0..budget {
            let Some(frame) = self.buffer.pop() else {
                return;
            };

            let bypass = is_raw_bypass(frame.len());
            if !bypass && !self.rtp.is_initialized() {
                // Opus-фрейм, но RTP ещё не готов.
                //
                // ArrayQueue не поддерживает возврат элемента в начало,
                // поэтому возвращаем его обратно в очередь и прекращаем
                // обработку текущего budget.
                //
                // Не пытаемся брать следующие элементы:
                // порядок Opus-пакетов должен сохраняться.
                let _ = self.buffer.push(frame);
                return;
            }

            let packet = if bypass {
                // Discovery (74) или keepalive (8) отправляются как есть.
                //
                // Keepalive обычно проходит через tick_alive(), но
                // дополнительная проверка здесь делает очередь безопаснее.
                frame
            } else {
                match self.rtp.packet(frame) {
                    Ok(packet) => packet,

                    Err(_e) => {
                        self.send_drops
                            .fetch_add(1, Ordering::Relaxed);

                        self.consecutive_failures
                            .fetch_add(1, Ordering::Relaxed);

                        #[cfg(debug_assertions)]
                        println!("RTP encrypt error: {}", _e);

                        // Не продолжаем burst после ошибки RTP.
                        //
                        // Причина: если RTP-контекст сломан, бессмысленно
                        // пытаться прогонять следующие Opus-пакеты через
                        // тот же неисправный state.
                        return;
                    }
                }
            };

            match self.socket.send(&packet) {
                Ok(_) => {
                    self.consecutive_failures
                        .store(0, Ordering::Relaxed);

                    self.last_send_ms
                        .store(now, Ordering::Relaxed);
                }

                Err(_e) => {
                    self.send_drops
                        .fetch_add(1, Ordering::Relaxed);

                    self.consecutive_failures
                        .fetch_add(1, Ordering::Relaxed);

                    #[cfg(debug_assertions)]
                    println!("UDP send error: {}", _e);

                    // Не продолжаем burst после WouldBlock / ошибки socket.
                    //
                    // Иначе один неудачный send может превратиться
                    // в несколько бесполезных попыток подряд.
                    return;
                }
            }
        }
    }

    /// Отправляет keepalive-пакет для поддержания NAT-сессии.
    ///
    /// Keepalive — это НЕ RTP: 8 сырых байт, без шифрования, без заголовка,
    /// без счётчиков `sequence`/`timestamp`/`counter` внутри `VoiceRTPSocket`.
    /// Работает даже до `initialize`.
    fn tick_alive(&self, now: u64) {
        let count = self.keepalive_counter.fetch_add(1, Ordering::Relaxed);
        let mut pkt = [0u8; KEEPALIVE_SIZE];
        pkt[0..4].copy_from_slice(&count.to_le_bytes()); // LE, как ждёт Discord

        match self.socket.send(&pkt) {
            Ok(_) => {
                self.last_send_ms.store(now, Ordering::Relaxed);
            }
            Err(e) if e.kind() == ErrorKind::WouldBlock => {
                // keepalive не критичен — пропускаем
            }
            Err(_e) => {
                #[cfg(debug_assertions)]
                println!("Keepalive send failed: {}", _e);
            }
        }
    }
}

/// При падении объекта автоматически вызывается destroy.
impl Drop for SocketInner {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        {
            use std::sync::atomic::Ordering;

            println!("====================");
            println!("UdpBufferedInner::drop");
            println!("send_drops={}", self.send_drops.load(Ordering::Relaxed));
            println!("last_send_ms={}", self.last_send_ms.load(Ordering::Relaxed));
            println!("keep_alive_counter={}", self.keepalive_counter.load(Ordering::Relaxed));
            println!("buffer_len={}", self.buffer.len());
            println!("buffer_cap={}", self.buffer.free_slots());
            println!("socket_strong={}", Arc::strong_count(&self.socket));
            println!("UdpBufferedInner dropped");
            println!("====================");
        }
    }
}