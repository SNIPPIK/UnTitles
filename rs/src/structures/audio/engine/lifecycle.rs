//! Уничтожение движка и `Drop`.

use super::{ AudioEngine };
use napi::bindgen_prelude::*;
use napi_derive::napi;
use std::sync::atomic::Ordering;

#[napi]
impl AudioEngine {
    /// Уничтожает движок. Идемпотентный.
    ///
    /// Если движок ещё не уничтожен, вызывает `force_destroy`.
    #[napi]
    pub fn destroy(&self) -> Result<()> {
        // Проверка без блокировки: force_destroy сам защищён атомарным флагом.
        if !self.destroyed.load(Ordering::Acquire) {
            self.force_destroy();
        }
        Ok(())
    }

    /// Принудительно уничтожает движок: останавливает поток чтения,
    /// убивает ffmpeg, очищает буфер. Идемпотентный.
    ///
    /// Порядок действий:
    /// 1. Выставляет `destroyed = true`, защищая от повторного вызова.
    /// 2. Сбрасывает `reading_active`, чтобы поток вышел из цикла.
    /// 3. Убивает и дожидается ffmpeg (освобождает stdout).
    /// 4. Будит оба condvar, чтобы поток вышел из ожиданий.
    /// 5. Дожидается завершения потока чтения.
    /// 6. Очищает буфер.
    pub fn force_destroy(&self) {
        // Идемпотентность: повторный вызов сразу выходит.
        if self.destroyed.swap(true, Ordering::AcqRel) {
            return;
        }

        // Останавливаем поток чтения.
        self.reading_active.store(false, Ordering::Release);

        // Убиваем ffmpeg: закрытие stdout разбудит блокирующий read в reader-потоке.
        {
            let mut child = self.child.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(mut process) = child.take() {
                // Если процесс уже завершился сам — не пытаемся его убивать.
                if process.try_wait().ok().flatten().is_none() {
                    let _ = process.kill();
                }
                // Обязательно дожидаемся reap'а, иначе останется zombie.
                let _ = process.wait();
            }
        }

        // Будим поток чтения, если он ждёт на паузе или на свободном месте буфера.
        self.pause_state.1.notify_all();
        self.buffer.1.notify_all();

        // Дожидаемся завершения потока чтения.
        {
            let mut handle = self.reader_handle.lock().unwrap_or_else(|p| p.into_inner());
            if let Some(join) = handle.take() {
                let _ = join.join();
            }
        }

        // Очищаем буфер и возвращаем память ОС.
        {
            let mut buffer = self.buffer.0.lock().unwrap_or_else(|p| p.into_inner());
            buffer.clear();
            // Освобождаем выделенную память, чтобы не держать её до уничтожения движка.
            buffer.shrink_to_fit();
        }
    }
}

/// Гарантированное освобождение ресурсов при удалении объекта.
impl Drop for AudioEngine {
    fn drop(&mut self) {
        // force_destroy идемпотентен, поэтому вызывается безусловно.
        self.force_destroy();
    }
}