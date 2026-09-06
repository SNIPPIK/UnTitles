use crossbeam_utils::CachePadded;
use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::atomic::{AtomicUsize, Ordering},
};

// ============================================================================
// Слот кольцевого буфера
// ============================================================================

/// Отдельный слот буфера: содержит атомарный счётчик состояния и данные.
struct Slot {
    /// Порядковый номер слота, управляет его состоянием (свободен/занят/готов).
    seq: AtomicUsize,

    /// Хранилище данных; инициализируется/читается вручную через unsafe.
    data: UnsafeCell<MaybeUninit<Vec<u8>>>
}

// Безопасно делить между потоками: весь доступ синхронизирован через seq.
unsafe impl Send for Slot {}
unsafe impl Sync for Slot {}

// ============================================================================
// Кольцевой буфер
// ============================================================================

/// Многопоточный (MPMC) lock-free FIFO буфер фиксированной ёмкости.
pub struct RingBuffer {
    /// Массив слотов.
    buffer: Box<[Slot]>,

    /// Максимальное количество элементов.
    capacity: usize,

    /// Голова — позиция следующей вставки (монотонно растёт).
    head: CachePadded<AtomicUsize>,

    /// Хвост — позиция следующего извлечения (монотонно растёт).
    tail: CachePadded<AtomicUsize>
}

impl RingBuffer {
    /// Создаёт кольцевой буфер заданной ёмкости.
    ///
    /// # Паника
    /// Паникует, если `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "capacity must be > 0");

        let mut slots = Vec::with_capacity(capacity);

        for i in 0..capacity {
            slots.push(Slot {
                // Инициализируем seq индексом: слот свободен для записи.
                seq: AtomicUsize::new(i),
                data: UnsafeCell::new(MaybeUninit::uninit()),
            });
        }

        Self {
            buffer: slots.into_boxed_slice(),
            capacity,
            head: CachePadded::new(AtomicUsize::new(0)),
            tail: CachePadded::new(AtomicUsize::new(0)),
        }
    }

    /// Пытается поместить `value` в буфер.
    ///
    /// Возвращает `Ok(())` при успехе, `Err(value)` при заполненном буфере.
    #[inline]
    pub fn push(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        // Загружаем текущую позицию головы.
        let mut pos = self.head.load(Ordering::Relaxed);

        loop {
            // Текущий слот по модулю ёмкости.
            let slot = &self.buffer[pos % self.capacity];
            // Acquire для seq: видим все записи от предыдущего потока.
            let seq = slot.seq.load(Ordering::Acquire);

            // Разница seq и pos; wrapping_sub корректно обрабатывает переполнение.
            let diff = seq.wrapping_sub(pos) as isize;

            if diff == 0 {
                // Слот свободен: пробуем атомарно занять позицию `pos`.
                match self.head.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // Успешно застолбили; записываем данные.
                        unsafe {
                            (*slot.data.get()).write(value);
                        }

                        // Сообщаем потребителям, что слот готов (seq = pos + 1).
                        slot.seq.store(
                            pos.wrapping_add(1),
                            Ordering::Release,
                        );

                        return Ok(());
                    }
                    Err(actual) => {
                        // CAS не удался: голова сдвинута другим потоком.
                        pos = actual;
                    }
                }
            } else if diff < 0 {
                // Буфер полон: seq отстаёт от pos.
                return Err(value);
            } else {
                // Голова продвинута, но seq ещё не обновлён; перечитываем.
                pos = self.head.load(Ordering::Relaxed);
            }
        }
    }

    /// Извлекает один элемент из буфера, если он есть.
    ///
    /// Возвращает `Some(value)` или `None`, если буфер пуст.
    #[inline]
    pub fn pop(&self) -> Option<Vec<u8>> {
        let mut pos = self.tail.load(Ordering::Relaxed);

        loop {
            let slot = &self.buffer[pos % self.capacity];
            let seq = slot.seq.load(Ordering::Acquire);

            // Готовый слот имеет seq == pos + 1.
            let diff = seq.wrapping_sub(pos.wrapping_add(1)) as isize;

            if diff == 0 {
                // Слот готов: пробуем занять позицию.
                match self.tail.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // Читаем данные (единственный читатель для этого pos).
                        let value = unsafe {
                            (*slot.data.get()).assume_init_read()
                        };

                        // Возвращаем слот в свободное состояние для следующего цикла.
                        // seq = pos + capacity.
                        slot.seq.store(
                            pos.wrapping_add(self.capacity),
                            Ordering::Release,
                        );

                        return Some(value);
                    }
                    Err(actual) => {
                        pos = actual;
                    }
                }
            } else if diff < 0 {
                // Буфер пуст.
                return None;
            } else {
                // Хвост сдвинут другим потоком.
                pos = self.tail.load(Ordering::Relaxed);
            }
        }
    }

    /// Извлекает до `limit` элементов и добавляет их в `out`.
    #[inline]
    pub fn pop_many(
        &self,
        out: &mut Vec<Vec<u8>>,
        limit: usize,
    ) {
        if limit == 0 {
            return;
        }

        out.reserve(limit);

        for _ in 0..limit {
            match self.pop() {
                Some(value) => out.push(value),
                None => break,
            }
        }
    }

    /// Текущее количество элементов (приблизительное).
    #[inline]
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        head.wrapping_sub(tail).min(self.capacity)
    }

    /// `true`, если буфер пуст.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Количество свободных слотов для записи.
    #[inline]
    pub fn capacity_remaining(&self) -> usize {
        self.capacity.saturating_sub(self.len())
    }

    /// `true`, если буфер заполнен полностью.
    #[inline]
    pub fn is_full(&self) -> bool {
        self.len() >= self.capacity
    }

    /// Очищает буфер.
    ///
    /// ВАЖНО:
    /// Должен вызываться только после остановки всех producers и consumers.
    pub fn clear(&self) {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Relaxed);

        // Количество элементов в буфере.
        let count = head.wrapping_sub(tail).min(self.capacity);

        // Дропаем каждый инициализированный слот.
        for offset in 0..count {
            let pos = tail.wrapping_add(offset);
            let slot = &self.buffer[pos % self.capacity];

            unsafe {
                // Приводим к Vec<u8> и дропаем.
                slot.data.get().cast::<Vec<u8>>().drop_in_place();
            }
        }

        // Сбрасываем голову и хвост в 0.
        self.head.store(0, Ordering::Relaxed);
        self.tail.store(0, Ordering::Relaxed);

        // Сбрасываем seq всех слотов в исходное значение (индекс).
        for (index, slot) in self.buffer.iter().enumerate() {
            slot.seq.store(index, Ordering::Relaxed);
        }
    }
}

impl Drop for RingBuffer {
    fn drop(&mut self) {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Relaxed);

        // Количество элементов, которые нужно дропнуть.
        let count = head.wrapping_sub(tail).min(self.capacity);

        // Дропаем все инициализированные данные.
        for offset in 0..count {
            let pos = tail.wrapping_add(offset);
            let slot = &mut self.buffer[pos % self.capacity];

            unsafe {
                slot.data.get_mut().assume_init_drop();
            }
        }
    }
}