use std::mem::MaybeUninit;
use std::sync::atomic::{AtomicUsize, Ordering};

/// Кольцевой буфер (ring buffer) для передачи `Vec<u8>` между потоками.
/// Предназначен для сценария **один производитель — один потребитель** (SPSC).
/// Без блокировок, использует атомарные индексы `head` и `tail`.
///
/// # Безопасность
/// - `buffer` хранит `MaybeUninit<Vec<u8>>`, чтобы не требовать инициализации при создании.
/// - `push` и `pop` используют правильные барьеры памяти для видимости изменений.
/// - `Drop` корректно извлекает оставшиеся элементы, предотвращая утечки.
pub struct RingBuffer {
    /// Предварительно выделенная память под `capacity` элементов.
    /// Элементы могут быть неинициализированы.
    buffer: Vec<MaybeUninit<Vec<u8>>>,
    /// Ёмкость буфера (фиксирована).
    capacity: usize,
    /// Индекс, по которому будет записан следующий элемент.
    /// Изменяется только производителем.
    head: AtomicUsize,
    /// Индекс, из которого будет прочитан следующий элемент.
    /// Изменяется только потребителем.
    tail: AtomicUsize,
}

impl RingBuffer {
    /// Создаёт новый кольцевой буфер с заданной ёмкостью.
    /// Паникует, если `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "Capacity must be greater than 0");

        // Создаём вектор нужного размера, заполненный неинициализированными элементами.
        let mut buffer = Vec::with_capacity(capacity);
        unsafe {
            // Устанавливаем длину вектора, не инициализируя память.
            // Это безопасно, потому что мы будем использовать слоты только после записи.
            buffer.set_len(capacity);
        }

        Self {
            buffer,
            capacity,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    /// Пытается добавить данные в буфер.
    /// Возвращает `Err(data)`, если буфер полон.
    ///
    /// # Ordering
    /// - `head` загружается с `Relaxed` — изменения `head` производит только этот поток.
    /// - `tail` загружается с `Acquire` — нужно увидеть все предыдущие изменения потребителя (pop).
    /// - `head` сохраняется с `Release` — гарантирует, что запись данных будет видна потребителю.
    pub fn push(&self, data: Vec<u8>) -> Result<(), Vec<u8>> {
        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) % self.capacity;

        // Если следующий head равен текущему tail — буфер переполнен.
        // Acquire: видим все изменения tail, сделанные потребителем.
        if next_head == self.tail.load(Ordering::Acquire) {
            return Err(data);
        }

        // Запись данных в слот.
        unsafe {
            // Получаем указатель на слот head. Используем арифметику указателей для избежания проверок.
            let slot = self.buffer.as_ptr().add(head) as *mut MaybeUninit<Vec<u8>>;
            // Записываем `MaybeUninit::new(data)` — помещаем данные в неинициализированный слот.
            slot.write(MaybeUninit::new(data));
        }

        // Обновляем head с Release, чтобы потребитель гарантированно увидел запись.
        self.head.store(next_head, Ordering::Release);
        Ok(())
    }

    /// Извлекает данные из буфера, если они есть.
    /// Возвращает `None`, если буфер пуст.
    ///
    /// # Ordering
    /// - `tail` загружается с `Relaxed` — изменения производит только этот поток.
    /// - `head` загружается с `Acquire` — нужно увидеть все записи производителя.
    /// - `tail` сохраняется с `Release` — чтобы производитель видел освободившееся место.
    pub fn pop(&self) -> Option<Vec<u8>> {
        let tail = self.tail.load(Ordering::Relaxed);

        // Если tail совпадает с head — буфер пуст.
        // Acquire: видим все записи производителя.
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }

        // Читаем данные из слота.
        unsafe {
            // `get_unchecked` безопасен, так как tail всегда в пределах [0, capacity).
            // `assume_init_read` перемещает `Vec<u8>` из слота, оставляя его неинициализированным.
            let data = self.buffer.get_unchecked(tail).assume_init_read();
            let next_tail = (tail + 1) % self.capacity;
            self.tail.store(next_tail, Ordering::Release);
            Some(data)
        }
    }

    /// Возвращает текущее количество элементов в буфере.
    /// Результат приближённый, так как между загрузками head и tail может произойти изменение.
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        if head >= tail {
            head - tail
        } else {
            self.capacity - tail + head
        }
    }

    /// Очищает буфер, извлекая все элементы.
    /// Предполагается, что другие потоки не обращаются к буферу одновременно.
    /// Обычно вызывается перед уничтожением.
    pub fn clear(&self) {
        while self.pop().is_some() {}
    }
}

/// Реализация `Drop` гарантирует, что все оставшиеся `Vec<u8>` будут корректно освобождены.
/// Без этого память, выделенная внутри `Vec`, могла бы утечь, потому что `MaybeUninit`
/// автоматически не вызывает деструкторы.
impl Drop for RingBuffer {
    fn drop(&mut self) {
        // Выкачиваем все элементы, которые ещё не были прочитаны.
        // Это безопасно, потому что в момент вызова `drop` другие потоки уже не имеют доступа к `self`.
        while self.pop().is_some() {}
    }
}