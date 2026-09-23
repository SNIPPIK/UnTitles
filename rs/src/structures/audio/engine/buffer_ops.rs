use super::AudioEngine;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::Ordering;

#[napi]
impl AudioEngine {
    // ============================================================
    // SIZE
    // ============================================================

    /// Возвращает текущее количество пакетов в буфере.
    ///
    /// Значение — мгновенный снимок: при конкурентной записи/чтении
    /// оно может устареть сразу после возврата.
    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        self.buffer
            .0
            .lock()
            .map(|buffer| buffer.len().min(u32::MAX as usize) as u32)
            .unwrap_or(0)
    }

    // ============================================================
    // POSITION
    // ============================================================

    /// Возвращает текущую позицию чтения.
    ///
    /// Позиция увеличивается на фактическое количество извлечённых
    /// аудио-пакетов.
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position
            .load(Ordering::Acquire)
            .min(u32::MAX as usize) as u32
    }

    /// Устанавливает позицию чтения вручную.
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(
            pos as usize,
            Ordering::Release,
        );
    }

    // ============================================================
    // GET PACKETS
    // ============================================================

    /// Извлекает до `count` пакетов из буфера.
    ///
    /// Если `count == 0`, извлекается один пакет.
    ///
    /// Если доступно меньше пакетов, возвращается фактически доступное
    /// количество.
    ///
    /// После успешного извлечения reader уведомляется о появившемся
    /// свободном месте.
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        // Быстрый путь.
        if self.destroyed.load(Ordering::Acquire) {
            return Vec::new();
        }

        let count = (count as usize).max(1);

        let (buffer_lock, buffer_cvar) = &*self.buffer;

        let raw_packets = {
            let buffer = match buffer_lock.lock() {
                Ok(buffer) => buffer,
                Err(_) => return Vec::new(),
            };

            // Важно проверить destroyed ещё раз ПОСЛЕ получения mutex.
            //
            // Иначе возможна гонка:
            //
            // get_packets() -> destroyed == false
            // destroy()    -> destroyed = true
            // get_packets() -> получает mutex и читает уже уничтожаемый buffer
            //
            // Сам mutex не даст use-after-free, но семантически операция
            // уже не должна выполняться.
            if self.destroyed.load(Ordering::Acquire) {
                return Vec::new();
            }

            let available = buffer.len();

            if available == 0 {
                return Vec::new();
            }

            let limit = count.min(available);
            let mut extracted = Vec::with_capacity(limit);

            buffer.pop_many(&mut extracted, limit);

            if extracted.is_empty() { return Vec::new(); }

            // Позиция соответствует фактически извлечённым пакетам.
            //
            // Не используем обычный fetch_add: теоретическое переполнение
            // usize не должно превращать позицию обратно в маленькое число.
            let increment = extracted.len();

            let _ = self.position.try_update(
                Ordering::Release,
                Ordering::Relaxed,
                |current| current.checked_add(increment),
            );

            extracted
        };

        // Mutex уже освобождён.
        buffer_cvar.notify_one();

        raw_packets
            .into_iter()
            .map(Buffer::from)
            .collect()
    }

    // ============================================================
    // ADD PACKETS
    // ============================================================

    /// Добавляет пакеты в буфер из JavaScript.
    ///
    /// Добавление прекращается при заполнении буфера.
    /// Ошибка переполнения не превращается в panic.
    ///
    /// Reader уведомляется только если хотя бы один пакет действительно
    /// был добавлен.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Vec<u8>>) {
        // Быстрый путь.
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let (buffer_lock, buffer_cvar) = &*self.buffer;
        let mut added_any = false;

        {
            let buffer = match buffer_lock.lock() {
                Ok(buffer) => buffer,
                Err(_) => return,
            };

            // Повторная проверка под mutex.
            if self.destroyed.load(Ordering::Acquire) {
                return;
            }

            for packet in packets {
                if buffer.is_full() { break; }

                match buffer.push(packet) {
                    Ok(()) => {
                        added_any = true;
                    }

                    Err(_) => {
                        // Не меняем active и не считаем это fatal error:
                        // публичный API специально работает как best-effort.
                        break;
                    }
                }
            }
        }

        // Не держим buffer mutex во время notify.
        if added_any {
            buffer_cvar.notify_one();
        }
    }

    // ============================================================
    // CAN ACCEPT
    // ============================================================

    /// Проверяет, есть ли в буфере место хотя бы под один пакет.
    #[napi]
    pub fn can_accept(&self) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let buffer = match self.buffer.0.lock() {
            Ok(buffer) => buffer,
            Err(_) => return false,
        };

        // Повторная проверка после захвата mutex.
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        !buffer.is_full()
    }

    // ============================================================
    // CAN ACCEPT THRESHOLD
    // ============================================================

    /// Проверяет, что заполненность буфера строго ниже указанного
    /// процента от `max_capacity`.
    ///
    /// `threshold_percent` автоматически ограничивается диапазоном
    /// `0..=100`.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let buffer = match self.buffer.0.lock() {
            Ok(buffer) => buffer,
            Err(_) => return false,
        };

        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        let percent = threshold_percent.min(100);

        // Не вычисляем:
        //
        // max_capacity * percent
        //
        // напрямую, чтобы не иметь потенциального overflow usize.
        //
        // Сравнение:
        //
        //   len / max_capacity < percent / 100
        //
        // выполняем через произведение с меньшим числом:
        //
        //   len * 100 < max_capacity * percent
        //
        // Здесь тоже возможен overflow, поэтому используем div_ceil-подобную
        // границу через количество допустимых элементов.
        let capacity = self.max_capacity;

        if capacity == 0 {
            return false;
        }

        // Количество элементов, которое должно оставаться недостигнутым:
        //
        // percent == 100 -> допустимы все значения ниже capacity
        // percent == 50  -> len < половины capacity
        let threshold = capacity
            .saturating_mul(percent as usize)
            / 100;

        buffer.len() < threshold
    }
}