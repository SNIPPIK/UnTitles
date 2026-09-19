//! Операции над кольцевым буфером и позицией чтения.

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
    /// Значение — мгновенный снимок: при конкурентной записи/чтении может
    /// устареть сразу после возврата. Полезно для метрик и грубых проверок.
    #[napi(getter)]
    pub fn get_size(&self) -> u32 {
        // При отравлении мьютекса возвращаем 0 — это безопаснее,
        // чем паниковать в JS-биндинге.
        self.buffer.0.lock().map(|b| b.len() as u32).unwrap_or(0)
    }

    // ============================================================
    // POSITION
    // ============================================================

    /// Возвращает текущую позицию чтения (число извлечённых пакетов).
    #[napi(getter)]
    pub fn get_position(&self) -> u32 {
        self.position.load(Ordering::Acquire) as u32
    }

    /// Устанавливает позицию чтения вручную.
    ///
    /// Полезно для перемотки, сброса счётчика или синхронизации состояния
    /// с внешней системой.
    ///
    /// # Аргументы
    /// * `pos` — новое значение позиции.
    #[napi(setter)]
    pub fn set_position(&self, pos: u32) {
        self.position.store(pos as usize, Ordering::Release);
    }

    /// Извлекает до `count` пакетов из буфера за один вызов N-API.
    ///
    /// Если `count == 0`, извлекается один пакет. Возвращает вектор
    /// `Buffer` (длина может быть меньше запрошенной). Позиция чтения
    /// увеличивается на фактическое число извлечённых пакетов. При
    /// извлечении будит поток чтения, если он ждал свободного места.
    ///
    /// # Аргументы
    /// * `count` — максимальное количество пакетов для извлечения.
    ///
    /// # Возвращаемое значение
    /// Вектор `Buffer`. Пустой вектор означает, что буфер пуст или движок
    /// уже уничтожен.
    #[napi]
    pub fn get_packets(&self, count: u32) -> Vec<Buffer> {
        // Не работаем с уничтоженным движком.
        if self.destroyed.load(Ordering::Acquire) {
            return Vec::new();
        }

        // При count == 0 извлекаем ровно один пакет.
        let count = if count == 0 { 1 } else { count } as usize;

        let (buffer_lock, buffer_cvar) = &*self.buffer;

        // Извлекаем пакеты под блокировкой.
        let raw_packets = {
            let buffer = match buffer_lock.lock() {
                Ok(b) => b,
                Err(_) => return Vec::new(),
            };

            // Ограничиваем запрос фактически доступным количеством.
            let limit = count.min(buffer.len());
            if limit == 0 {
                return Vec::new();
            }

            let mut extracted = Vec::with_capacity(limit);
            buffer.pop_many(&mut extracted, limit);

            // Обновляем позицию на фактическое число извлечённых пакетов.
            if !extracted.is_empty() {
                self.position.fetch_add(extracted.len(), Ordering::Release);
            }

            extracted
        };

        // Уведомляем reader о появлении свободного места — вне блокировки,
        // чтобы не будить поток, пока мьютекс ещё удерживается.
        if !raw_packets.is_empty() {
            buffer_cvar.notify_one();
        }

        // Преобразуем Vec<u8> в Buffer для передачи через FFI.
        raw_packets.into_iter().map(Buffer::from).collect()
    }

    /// Добавляет пакеты в буфер из JavaScript.
    ///
    /// При заполнении буфера прекращает добавление, не бросая ошибку.
    /// После добавления уведомляет ожидающего читателя.
    ///
    /// # Аргументы
    /// * `packets` — массив данных для добавления.
    #[napi]
    pub fn add_packets(&self, packets: Vec<Vec<u8>>) {
        if self.destroyed.load(Ordering::Acquire) {
            return;
        }

        let (buffer_lock, buffer_cvar) = &*self.buffer;
        let buffer = match buffer_lock.lock() {
            Ok(b) => b,
            Err(_) => return,
        };

        for packet in packets {
            // Прекращаем добавление при заполнении буфера.
            if buffer.is_full() {
                break;
            }
            // Ошибка push (переполнение) — тоже стоп, без паники.
            if buffer.push(packet).is_err() {
                return;
            }
        }

        // Уведомляем возможного ожидающего reader'а о появлении данных.
        buffer_cvar.notify_one();
    }

    /// Проверяет, есть ли в буфере место хотя бы под один новый пакет.
    ///
    /// # Возвращаемое значение
    /// `true`, если текущий размер буфера меньше `max_capacity`.
    /// `false`, если буфер заполнен или движок уничтожен.
    #[napi]
    pub fn can_accept(&self) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }
        self.buffer
            .0
            .lock()
            .map(|b| b.len() < self.max_capacity)
            .unwrap_or(false)
    }

    /// Проверяет, что заполненность буфера ниже указанного процента от `max_capacity`.
    ///
    /// Используется для управления backpressure из JavaScript: пока порог
    /// не превышен, можно продолжать подавать данные.
    ///
    /// # Аргументы
    /// * `threshold_percent` — пороговый процент заполненности (0..=100).
    ///   Значения больше 100 обрезаются до 100.
    ///
    /// # Возвращаемое значение
    /// `true`, если текущая заполненность ниже порога; иначе `false`.
    #[napi]
    pub fn can_accept_threshold(&self, threshold_percent: u32) -> bool {
        if self.destroyed.load(Ordering::Acquire) {
            return false;
        }

        // Ограничиваем процент до 100, чтобы избежать порога выше ёмкости.
        let threshold = (self.max_capacity * threshold_percent.min(100) as usize) / 100;

        self.buffer
            .0
            .lock()
            .map(|b| b.len() < threshold)
            .unwrap_or(false)
    }
}