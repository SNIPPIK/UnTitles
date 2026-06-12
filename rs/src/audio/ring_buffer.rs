use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    ptr,
    sync::atomic::{AtomicUsize, Ordering},
};

#[repr(align(64))]
struct CacheAlignedAtomic(AtomicUsize);

impl CacheAlignedAtomic {
    #[inline]
    const fn new(val: usize) -> Self {
        Self(AtomicUsize::new(val))
    }
}

pub struct RingBuffer {
    /// Хранилище: массив фиксированной длины, каждый элемент — UnsafeCell<MaybeUninit<Vec<u8>>>.
    /// - `UnsafeCell` нужен для внутренней мутабельности через разделяемую ссылку &self.
    /// - `MaybeUninit` позволяет отложить инициализацию слотов (не создавать Vec впустую).
    buffer: Box<[UnsafeCell<MaybeUninit<Vec<u8>>>]>,

    /// Реальная ёмкость = capacity + 1 (см. алгоритм с отличием head и tail).
    capacity: usize,
    head: CacheAlignedAtomic,
    tail: CacheAlignedAtomic
}

// ============================================================================
// SAFETY (обоснование вручную реализованных Send/Sync)
// ============================================================================
//
/// `Send`: RingBuffer может быть передан в другой поток, потому что:
/// - все операции используют атомарные индексы и не требуют привязки к текущему потоку.
/// - единственный владелец структуры может переместить её.
unsafe impl Send for RingBuffer {}

/// `Sync`: разделяемый доступ (&RingBuffer) из нескольких потоков безопасен благодаря:
/// - доступ к слотам через UnsafeCell защищён логикой SPSC (один поток пишет, другой читает, никогда одновременно в один слот)
/// - Ordering::Release/Ordering::Acquire синхронизируют операции записи/чтения данных.
unsafe impl Sync for RingBuffer {}

// ============================================================================
// CONSTRUCTOR
// ============================================================================

impl RingBuffer {
    /// Создаёт буфер с `capacity` элементами.
    /// Внутренний реальный размер = capacity + 1, поэтому буфер может хранить максимум `capacity` элементов.
    /// Передаваемый `capacity` должен быть > 0.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "Capacity must be greater than 0");

        let real_capacity = capacity + 1;

        // Инициализируем Vec из UnsafeCell<MaybeUninit<...>>, заполняя `real_capacity` элементов.
        // Все слоты изначально неинициализированы (MaybeUninit::uninit()).
        let mut vec = Vec::with_capacity(real_capacity);
        for _ in 0..real_capacity {
            vec.push(UnsafeCell::new(MaybeUninit::uninit()));
        }

        RingBuffer {
            buffer: vec.into_boxed_slice(),
            capacity: real_capacity,
            head: CacheAlignedAtomic::new(0),
            tail: CacheAlignedAtomic::new(0),
        }
    }

    // =========================================================================
    // INFO
    // =========================================================================

    /// Проверка на пустоту.
    /// Используется Acquire для чтения tail и head, чтобы гарантировать, что если мы увидели head == tail,
    /// то все предыдущие записи head (от продьюсера) стали видимы, а также мы не «заглядываем» вперёд.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.head.0.load(Ordering::Acquire) == self.tail.0.load(Ordering::Acquire)
    }

    /// Текущее количество элементов в очереди.
    /// Вычисляет разницу между head и tail по модулю capacity (кольцевая арифметика).
    #[inline]
    pub fn len(&self) -> usize {
        let head = self.head.0.load(Ordering::Acquire);
        let tail = self.tail.0.load(Ordering::Acquire);

        if head >= tail {
            head - tail
        } else {
            self.capacity - tail + head
        }
    }

    /// Проверка на заполненность.
    /// Буфер считается полным, если следующий за head слот равен tail (т.е. остался ровно один свободный слот,
    /// который мы не используем для различения состояний "полный" и "пустой").
    #[inline]
    pub fn is_full(&self) -> bool {
        let head = self.head.0.load(Ordering::Relaxed);
        let next = (head + 1) % self.capacity;
        next == self.tail.0.load(Ordering::Acquire)
    }

    // =========================================================================
    // PUSH
    // =========================================================================

    /// Добавляет данные в очередь. В случае успеха возвращает Ok(())
    /// Если очередь полна или данные не прошли валидацию (пустые, <3 байт или >MAX_PACKET_SIZE) — возвращает Err(data).
    ///
    /// **Валидация:** минимальная длина 3 — предположительно, чтобы отсечь некорректные UDP/Opus фрагменты.
    ///
    /// **Атомарный порядок:**
    /// - `head` загружается с `Relaxed` (не требует синхронизации, т.к. запись head производит только этот поток-продьюсер).
    /// - Проверка на полный буфер использует `Acquire` при чтении `tail` — это гарантирует, что мы увидим последнее
    ///   обновление `tail` от консьюмера (включая все предыдущие операции чтения данных).
    /// - Запись в слот делается через указатель (`*slot.write(data)`), после чего публикуем новый `head`
    ///   с `Release`, чтобы все записи данных стали видимы консьюмеру, который загрузит `head` с `Acquire`.
    pub fn push(&self, data: Vec<u8>) -> Result<(), Vec<u8>> {
        let head = self.head.0.load(Ordering::Relaxed);
        let next_head = (head + 1) % self.capacity;

        if next_head == self.tail.0.load(Ordering::Acquire) {
            return Err(data);
        }

        unsafe {
            let slot = self.buffer[head].get();
            // Пишем данные прямо в ячейку, перезаписывая предыдущий MaybeUninit.
            // В этот момент слот гарантированно свободен, потому что:
            // - head всегда указывает на слот, который ранее был прочитан консьюмером (или изначально неинициализирован)
            // - и мы проверили, что очередь не полна, слот не занят живыми данными.
            (*slot).write(data);
        }

        self.head.0.store(next_head, Ordering::Release);
        Ok(())
    }

    // =========================================================================
    // POP
    // =========================================================================

    /// Извлекает элемент из очереди. Возвращает `Some(Vec<u8>)` или `None`, если очередь пуста.
    ///
    /// **Атомарный порядок:**
    /// - `tail` загружается с `Relaxed` (этот поток — единственный, кто пишет `tail`).
    /// - Сравнение с `head` использует `Acquire`, чтобы увидеть последние записи продьюсера.
    /// - После чтения данных (ptr::read) мы сдвигаем `tail` с `Release` – это гарантирует,
    ///   что всё чтение из слота завершится до того, как увидит новый `tail` (через свою загрузку `tail` с Acquire в push).
    /// - `ptr::read` перемещает Vec из слота, не вызывая деструктор старого содержимого (оно переходит во владение вызывающему).
    ///   Слот после этого становится неинициализированным (содержит «дырку»). Потом просто запишет новый Vec через write,
    ///   что корректно (MaybeUninit позволяет повторную инициализацию).
    pub fn pop(&self) -> Option<Vec<u8>> {
        let tail = self.tail.0.load(Ordering::Relaxed);

        if tail == self.head.0.load(Ordering::Acquire) {
            return None;
        }

        let next_tail = (tail + 1) % self.capacity;

        let value = unsafe {
            let slot = self.buffer[tail].get();
            // as_ptr() даёт *const MaybeUninit<Vec<u8>>, далее разыменовываем до MaybeUninit,
            // и as_ptr() на нём даёт *const Vec<u8>. ptr::read копирует байты Vec (т.е. перемещает ownership).
            ptr::read((*slot).as_ptr())
        };

        self.tail.0.store(next_tail, Ordering::Release);
        Some(value)
    }

    // =========================================================================
    // PEEK
    // =========================================================================

    /// Клонирует элемент по относительному индексу (0 – первый в очереди, 1 – следующий и т.д.).
    /// Возвращает `None`, если индекс выходит за пределы текущей длины.
    ///
    /// **ВАЖНО:** Этот метод не синхронизирован с `pop()`. Вызов `get_clone_at` одновременно с `pop()` из другого потока
    /// может привести к гонке данных (читаем слот, который в этот момент удаляется). Используйте только когда гарантировано,
    /// что `pop` не вызывается конкурентно (например, вы сами реализуете внешний мьютекс или знаете, что консьюмер остановлен).
    /// Для SPSC это нарушает гарантии – метод добавлен для удобного доступа "только для чтения" в однопоточном
    /// контексте или с дополнительной синхронизацией.
    pub fn get_clone_at(&self, index: usize) -> Option<Vec<u8>> {
        let tail = self.tail.0.load(Ordering::Relaxed);
        let head = self.head.0.load(Ordering::Acquire);

        let current_len = if head >= tail {
            head - tail
        } else {
            self.capacity - tail + head
        };

        if index >= current_len {
            return None;
        }

        let real_index = (tail + index) % self.capacity;

        unsafe {
            let slot = self.buffer[real_index].get();
            Some((*slot).assume_init_ref().clone())
        }
    }

    // =========================================================================
    // CLEAR
    // =========================================================================

    /// Очищает очередь, удаляя все элементы (вызывает drop для каждого Vec).
    /// Принимает `&mut self`, т.к. во время очистки не должно быть конкурентных операций – зачищаем всё подряд.
    pub fn clear(&mut self) {
        while self.pop().is_some() {}
    }
}

// ============================================================================
// DROP
// ============================================================================

impl Drop for RingBuffer {
    /// Корректно уничтожает все оставшиеся в буфере Vec, а затем освобождает память буфера.
    ///
    /// Почему нельзя просто положиться на деструктор `Box<[_]>`? Потому что слоты содержат `MaybeUninit<Vec<u8>>`,
    /// а `MaybeUninit` не вызывает деструктор автоматически. Нужно вручную пройти по всем занятым слотам (от tail до head)
    /// и вызвать `drop_in_place` для каждого `Vec`. После этого память самой `Box` будет освобождена.
    fn drop(&mut self) {
        let head = self.head.0.load(Ordering::Relaxed);
        let mut tail = self.tail.0.load(Ordering::Relaxed);

        while tail != head {
            unsafe {
                let slot = self.buffer[tail].get();
                // as_mut_ptr() даёт *mut MaybeUninit<Vec<u8>>, приводим к *mut Vec<u8> и удаляем.
                ptr::drop_in_place((*slot).as_mut_ptr());
            }
            tail = (tail + 1) % self.capacity;
        }
    }
}