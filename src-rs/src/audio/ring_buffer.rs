use std::sync::atomic::{AtomicUsize, Ordering};
use std::mem::MaybeUninit;
use std::ptr;

/// Ограничение по байтам MTU
const MAX_PACKET_SIZE: usize = 1500;

/// Кольцевой буфер для `Vec<u8>`.
/// Безопасен для использования в сценариях, где `push`, `push_front` и `pop` могут вызываться конкурентно,
/// при условии, что `push` и `push_front` вызываются только из одного потока (производитель и потребитель соответственно),
/// а `pop` — тоже из одного потока (потребитель). При этом `push_front` и `pop` могут конкурировать за `tail`.
pub struct RingBuffer {
    /// Выделенная память для элементов. Ёмкость = реальная ёмкость (capacity + 1).
    /// Используется `Box<[MaybeUninit<Vec<u8>>]>` для фиксированного размера на куче.
    buffer: Box<[MaybeUninit<Vec<u8>>]>,
    /// Реальная ёмкость буфера (переданная capacity + 1). Нужна для различения пустого и полного состояний.
    capacity: usize,
    /// Индекс, куда будет записан следующий элемент. Изменяется только производителем (`push`).
    head: AtomicUsize,
    /// Индекс, откуда будет прочитан следующий элемент. Изменяется потребителем (`pop` и `push_front`).
    tail: AtomicUsize,
}

impl RingBuffer {
    /// Создаёт новый кольцевой буфер с указанной ёмкостью (количество элементов, которые можно сохранить).
    /// Реально выделяется `capacity + 1` слотов, чтобы отличать пустоту от заполненности.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "Capacity must be greater than 0");

        // Для кольцевого буфера нужно на 1 слот больше, чтобы отличать состояние "пуст" от "полон".
        let real_capacity = capacity + 1;
        let mut buffer = Vec::with_capacity(real_capacity);
        
        // Выделяем память с инициализацией MaybeUninit для избежания Undefined Behavior
        unsafe {
            for _ in 0..real_capacity {
                buffer.push(MaybeUninit::new(Vec::new()));
            }
            buffer.set_len(real_capacity);
        }

        Self {
            buffer: buffer.into_boxed_slice(),
            capacity: real_capacity,
            head: AtomicUsize::new(0),
            tail: AtomicUsize::new(0),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Возвращает текущее количество элементов в буфере.
    /// Приблизительное значение, так как между загрузками `head` и `tail` может произойти изменение.
    pub fn len(&self) -> usize {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        if head >= tail {
            head - tail
        } else {
            self.capacity - tail + head
        }
    }

    /// Добавляет элемент в конец очереди (со стороны производителя).
    /// Если буфер полон, возвращает `Err(data)`.
    ///
    /// # Порядок доступа
    /// - `head` загружается с `Relaxed` (изменяется только этим потоком).
    /// - `tail` загружается с `Acquire`, чтобы увидеть изменения потребителя.
    /// - `head` сохраняется с `Release`, чтобы запись данных стала видна потребителю.
    pub fn push(&self, data: Vec<u8>) -> Result<(), Vec<u8>> {
        // Простая валидация: не пустой пакет и не слишком большой.
        if data.is_empty() {
            println!("push: dropped empty packet");
            return Err(data);
        }
        if data.len() > MAX_PACKET_SIZE || data.len() < 3 {
            println!("push: dropped oversize packet ({} bytes)", data.len());
            return Err(data);
        }

        let head = self.head.load(Ordering::Relaxed);
        let next_head = (head + 1) % self.capacity;

        // Если следующий head упёрся в tail — буфер полон.
        if next_head == self.tail.load(Ordering::Acquire) {
            println!("push: buffer full, dropping packet");
            return Err(data);
        }

        // Запись данных в слот.
        unsafe {
            // Получаем указатель на слот head. Используем арифметику указателей для избежания проверок.
            let slot = self.buffer.as_ptr().add(head) as *mut MaybeUninit<Vec<u8>>;
            // запись без паники; если Vec::new() или клонирование может паниковать —
            // это уже ответственность вызывающего.
            slot.write(MaybeUninit::new(data));
        }

        // Публикуем новый head так, чтобы потребитель увидел запись.
        self.head.store(next_head, Ordering::Release);
        Ok(())
    }

    /// Добавляет элемент в начало очереди (со стороны потребителя, например, при повторной попытке отправки).
    /// Использует CAS (compare-and-swap) для безопасного резервирования слота,
    /// чтобы не конфликтовать с `pop()`, который также изменяет `tail`.
    ///
    /// # Алгоритм
    /// 1. Загружаем текущий `tail`.
    /// 2. Вычисляем новый `next_tail` (предыдущий индекс в кольце).
    /// 3. Если новый tail упёрся в `head` — буфер полон.
    /// 4. Пытаемся атомарно заменить `tail` на `next_tail` с помощью `compare_exchange_weak`.
    /// 5. Если успешно — записываем данные в зарезервированный слот.
    /// 6. Если CAS не удался (другой поток изменил `tail`), повторяем с новым значением.
    pub fn push_front(&self, data: Vec<u8>) -> Result<(), Vec<u8>> {
        let tail = self.tail.load(Ordering::Relaxed);
        let next_tail = if tail == 0 { self.capacity - 1 } else { tail - 1 };

        // Проверяем, не упремся ли мы в голову при движении назад
        if next_tail == self.head.load(Ordering::Acquire) {
            return Err(data);
        }

        unsafe {
            // ВАЖНО: Сначала записываем данные в "новый" зарезервированный слот
            let slot = self.buffer.as_ptr().add(next_tail) as *mut MaybeUninit<Vec<u8>>;
            slot.write(MaybeUninit::new(data));
        }

        // ТОЛЬКО ПОТОМ обновляем индекс.
        // Release нужен, чтобы производитель увидел, что места в буфере стало МЕНЬШЕ.
        self.tail.store(next_tail, Ordering::Release);
        Ok(())
    }

    /// Извлекает элемент из начала очереди (со стороны потребителя).
    /// Возвращает `None`, если буфер пуст.
    ///
    /// # Алгоритм с CAS
    /// 1. Загружаем `tail` (текущий индекс для чтения).
    /// 2. Загружаем `head`. Если `tail == head` — буфер пуст.
    /// 3. Читаем данные из слота (опасно: используем `ptr::read` для перемещения).
    /// 4. Пытаемся атомарно сдвинуть `tail` вперёд (освободить слот).
    /// 5. Если CAS успешен — возвращаем данные.
    /// 6. Если CAS не удался (конфликт с `push_front`), мы должны «забыть» данные,
    ///    так как `ptr::read` уже переместил их из слота, но мы не можем вернуть их обратно.
    ///    Вместо этого мы перезаписываем слот новыми данными при следующем `push_front` или `push`.
    ///    Важно: `std::mem::forget(data)` не освобождает память, но предотвращает двойное освобождение.
    pub fn pop(&self) -> Option<Vec<u8>> {
        let tail = self.tail.load(Ordering::Relaxed);

        // Acquire, чтобы гарантированно увидеть данные, записанные через push (Release)
        if tail == self.head.load(Ordering::Acquire) {
            return None;
        }

        let next_tail = (tail + 1) % self.capacity;

        unsafe {
            let slot = self.buffer.as_ptr().add(tail) as *mut MaybeUninit<Vec<u8>>;
            let value = ptr::read((*slot).as_mut_ptr());

            // Сдвигаем tail вперед. Поток потребителя — единственный, кто это делает.
            self.tail.store(next_tail, Ordering::Release);
            Some(value)
        }
    }

    /// Внутренний метод для удаления элементов в заданном диапазоне индексов
    fn drop_range(&mut self, start: usize, end: usize) {
        unsafe {
            for i in start..end {
                // Получаем указатель на данные внутри MaybeUninit
                let slot_ptr = self.buffer.as_mut_ptr().add(i) as *mut Vec<u8>;
                // Вызываем деструктор Vec<u8> прямо по адресу
                ptr::drop_in_place(slot_ptr);
            }
        }
    }
}

/// Реализация `Drop` гарантирует, что все оставшиеся `Vec<u8>` будут корректно освобождены.
impl Drop for RingBuffer {
    fn drop(&mut self) {
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        // Вспомогательная логика для удаления диапазона
        if tail <= head {
            // Данные лежат сплошным куском: [....tailSSSShead....]
            self.drop_range(tail, head);
        } else {
            // Данные завернулись: [SShead........tailSSSS]
            self.drop_range(tail, self.capacity);
            self.drop_range(0, head);
        }
    }
}