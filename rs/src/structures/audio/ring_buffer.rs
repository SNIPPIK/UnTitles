use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    ptr,
    sync::atomic::{AtomicUsize, Ordering}
};

// ============================================================================
// Выравнивание под строку кэша
// ============================================================================

/// Обёртка, гарантирующая 64-байтное выравнивание поля.
/// Предотвращает ложное разделение (false sharing) между ядрами процессора.
#[repr(align(64))]
struct CachePadded<T>(T);

// ============================================================================
// Слот кольцевого буфера
// ============================================================================

/// Отдельный слот буфера, хранящий полезную нагрузку и синхронизационный счётчик.
///
/// # Протокол
/// Каждый слот имеет поле `seq`, которое сравнивается с глобальным индексом
/// для определения состояния слота:
/// - **seq == индекс** → слот свободен для записи.
/// - **seq == индекс + 1** → слот содержит готовые данные для чтения.
/// - Иначе — слот либо занят, либо находится в промежуточном состоянии.
///
/// После чтения `seq` устанавливается в `индекс + ёмкость`,
/// возвращая слот в свободное состояние для следующего цикла.
struct Slot {
    /// Порядковый номер, управляющий состоянием слота.
    /// Используется для координации доступа без блокировок.
    seq: AtomicUsize,

    /// Полезная нагрузка. Доступ синхронизируется через `seq`
    /// согласно правилам Acquire/Release.
    data: UnsafeCell<MaybeUninit<Vec<u8>>>
}

// Данный тип безопасно передавать и делить между потоками,
// так как весь доступ к `data` защищён атомарным протоколом.
unsafe impl Send for Slot {}
unsafe impl Sync for Slot {}

// ============================================================================
// Кольцевой буфер
// ============================================================================

/// Многопоточный (MPMC) lock-free FIFO-буфер фиксированного размера.
///
/// Позволяет одному или нескольким производителям вставлять элементы,
/// а одному или нескольким потребителям извлекать их. Никакие два потока
/// не блокируют друг друга, за исключением кратковременных попыток
/// атомарного CAS.
///
/// # Особенности
/// - Фиксированная ёмкость, задаваемая при создании.
/// - Гарантированно корректное освобождение ресурсов даже в случае
///   частично заполненного буфера (через `Drop`).
/// - `len()`, `is_empty()`, `is_full()` дают приблизительные значения
///   и не линеаризуемы.
pub struct RingBuffer {
    /// Непрерывный массив слотов, индексируемый по модулю `capacity`.
    buffer: Box<[Slot]>,
    /// Максимальное количество элементов, которое может одновременно
    /// находиться в буфере.
    capacity: usize,

    /// Голова — позиция следующей вставки (монотонно возрастает).
    head: CachePadded<AtomicUsize>,
    /// Хвост — позиция следующего извлечения (монотонно возрастает).
    tail: CachePadded<AtomicUsize>,
}

// RingBuffer владеет данными и синхронизирует доступ, поэтому
// Send и Sync реализуются безопасно.
unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
    // ------------------------------------------------------------------------
    // Конструктор
    // ------------------------------------------------------------------------

    /// Создаёт новый кольцевой буфер заданной ёмкости.
    ///
    /// # Паника
    /// Паникует, если `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "capacity must be > 0");

        let mut slots = Vec::with_capacity(capacity);
        for i in 0..capacity {
            slots.push(Slot {
                // Инициализируем seq индексом, означающим «слот свободен».
                seq: AtomicUsize::new(i),
                data: UnsafeCell::new(MaybeUninit::uninit()),
            });
        }

        Self {
            buffer: slots.into_boxed_slice(),
            capacity,
            head: CachePadded(AtomicUsize::new(0)),
            tail: CachePadded(AtomicUsize::new(0)),
        }
    }

    /// Возвращает максимальную ёмкость буфера.
    #[cfg(debug_assertions)]
    #[inline]
    pub fn capacity(&self) -> usize {
        self.capacity
    }

    // ------------------------------------------------------------------------
    // Вставка (push)
    // ------------------------------------------------------------------------

    /// Пытается поместить `value` в буфер.
    ///
    /// В случае успеха возвращает `Ok(())`, при заполненном буфере —
    /// `Err(value)`, где `value` — исходное значение (не теряется).
    ///
    /// # Потокобезопасность
    /// Может безопасно вызываться из нескольких потоков-производителей.
    pub fn push(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        // Загружаем текущую позицию головы.
        let mut pos = self.head.0.load(Ordering::Relaxed);

        loop {
            // Индекс слота в массиве.
            let slot = &self.buffer[pos % self.capacity];
            // Загружаем seq слотов с семантикой Acquire, чтобы увидеть
            // все записи данных, сделанные предыдущим потоком.
            let seq = slot.seq.load(Ordering::Acquire);

            // Разница между seq и pos. Поскольку счётчики монотонно растут,
            // используем wrapping_sub для корректного сравнения при переполнениях.
            let diff = seq.wrapping_sub(pos) as isize;

            if diff == 0 {
                // Слот свободен. Пытаемся атомарно зарезервировать позицию `pos`.
                match self.head.0.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // Только один поток может оказаться здесь для данного `pos`.
                        // Записываем данные в слот.
                        unsafe {
                            ptr::write((*slot.data.get()).as_mut_ptr(), value);
                        }
                        // Сообщаем потребителям, что слот заполнен.
                        slot.seq.store(pos.wrapping_add(1), Ordering::Release);
                        return Ok(());
                    }
                    Err(actual) => {
                        // CAS не удался — другой поток уже сдвинул голову.
                        // Обновляем `pos` и пробуем снова.
                        pos = actual;
                    }
                }
            } else if diff < 0 {
                // Буфер полон (seq отстаёт от pos). Возвращаем значение.
                return Err(value);
            } else {
                // Другой поток продвинул голову, но ещё не обновил seq.
                // Перечитываем свежее значение головы.
                pos = self.head.0.load(Ordering::Relaxed);
            }
        }
    }

    // ------------------------------------------------------------------------
    // Извлечение (pop)
    // ------------------------------------------------------------------------

    /// Извлекает один элемент из буфера, если он доступен.
    ///
    /// Возвращает `Some(value)`, если элемент был успешно извлечён,
    /// или `None`, если буфер пуст.
    pub fn pop(&self) -> Option<Vec<u8>> {
        let mut pos = self.tail.0.load(Ordering::Relaxed);

        loop {
            let slot = &self.buffer[pos % self.capacity];
            let seq = slot.seq.load(Ordering::Acquire);

            // Здесь сравниваем seq с pos + 1, потому что заполненный слот
            // имеет seq == pos + 1 (после записи).
            let diff = seq.wrapping_sub(pos.wrapping_add(1)) as isize;

            if diff == 0 {
                // Слот содержит данные. Пытаемся застолбить позицию.
                match self.tail.0.compare_exchange_weak(
                    pos,
                    pos.wrapping_add(1),
                    Ordering::Relaxed,
                    Ordering::Relaxed,
                ) {
                    Ok(_) => {
                        // Читаем данные (единственный поток-читатель для этого `pos`).
                        let value = unsafe { ptr::read((*slot.data.get()).as_ptr()) };
                        // Возвращаем слот в свободное состояние для следующего цикла.
                        // seq = pos + capacity гарантирует, что слот будет свободен,
                        // когда голова достигнет pos + capacity.
                        slot.seq.store(
                            pos.wrapping_add(self.capacity),
                            Ordering::Release,
                        );
                        return Some(value);
                    }
                    Err(actual) => pos = actual,
                }
            } else if diff < 0 {
                // Буфер пуст.
                return None;
            } else {
                // Хвост был сдвинут другим потоком, обновляем.
                pos = self.tail.0.load(Ordering::Relaxed);
            }
        }
    }

    /// Извлекает до `limit` элементов и добавляет их в переданный вектор `out`.
    ///
    /// Метод эффективен: память резервируется заранее.
    pub fn pop_many(&self, out: &mut Vec<Vec<u8>>, limit: usize) {
        out.reserve(limit);
        for _ in 0..limit {
            match self.pop() {
                Some(value) => out.push(value),
                None => break,
            }
        }
    }

    // ------------------------------------------------------------------------
    // Информационные методы (приблизительные, не линеаризуемы)
    // ------------------------------------------------------------------------

    /// Текущее приблизительное количество элементов в буфере.
    #[inline]
    pub fn len(&self) -> usize {
        let head = self.head.0.load(Ordering::Acquire);
        let tail = self.tail.0.load(Ordering::Acquire);
        head.saturating_sub(tail)
    }

    /// Возвращает `true`, если буфер пуст (на момент вызова).
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Количество свободных слотов для записи.
    #[inline]
    pub fn capacity_remaining(&self) -> usize {
        self.capacity.saturating_sub(self.len().min(self.capacity))
    }

    /// Возвращает `true`, если буфер полностью заполнен.
    #[inline]
    pub fn is_full(&self) -> bool {
        self.capacity_remaining() == 0
    }

    // ------------------------------------------------------------------------
    // Очистка
    // ------------------------------------------------------------------------

    /// Безопасно осушает очередь, извлекая и уничтожая все элементы.
    ///
    /// После вызова буфер окажется в состоянии «пуст».
    pub fn clear(&self) {
        while self.pop().is_some() {}

        self.head.0.store(0, Ordering::Relaxed);
        self.tail.0.store(0, Ordering::Relaxed);

        for (i, slot) in self.buffer.iter().enumerate() {
            slot.seq.store(i, Ordering::Relaxed);
        }
    }
}

// ============================================================================
// Деструктор
// ============================================================================

impl Drop for RingBuffer {
    fn drop(&mut self) {
        #[cfg(debug_assertions)]
        println!(
            "RingBuffer drop len={} cap={} head={} tail={}",
            self.len(),
            self.capacity(),
            self.head.0.load(Ordering::Relaxed),
            self.tail.0.load(Ordering::Relaxed),
        );

        // При удалении буфера необходимо корректно освободить все
        // оставшиеся элементы в слотах от tail до head.
        let head = self.head.0.load(Ordering::Relaxed);
        let tail = self.tail.0.load(Ordering::Relaxed);

        for pos in tail..head {
            let slot = &mut self.buffer[pos % self.capacity];
            // Каждый слот в диапазоне [tail, head) гарантированно содержит
            // инициализированное значение.
            unsafe {
                ptr::drop_in_place((*slot.data.get()).as_mut_ptr());
            }
        }
    }
}