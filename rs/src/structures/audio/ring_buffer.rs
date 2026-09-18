use crossbeam_utils::CachePadded;
use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::atomic::{AtomicUsize, Ordering},
};

/// Многопоточный SPSC lock-free кольцевой буфер.
///
/// Архитектура:
///
/// Producer:
///     head -> изменяется только producer
///     tail -> только читается
///
/// Consumer:
///     tail -> изменяется только consumer
///     head -> только читается
///
/// Важно:
/// - только ОДИН поток может вызывать `push` / `push_many`;
/// - только ОДИН поток может вызывать `pop` / `pop_many`;
/// - producer и consumer могут работать одновременно.
///
/// `head` и `tail` монотонно увеличиваются и используются только
/// для вычисления позиции внутри кольца.
pub struct RingBuffer {
    /// Хранилище элементов.
    buffer: Box<[UnsafeCell<MaybeUninit<Vec<u8>>>]>,

    /// Физическая ёмкость кольца.
    capacity: usize,

    /// Следующая позиция для записи.
    ///
    /// Изменяется только producer.
    head: CachePadded<AtomicUsize>,

    /// Следующая позиция для чтения.
    ///
    /// Изменяется только consumer.
    tail: CachePadded<AtomicUsize>,
}

// SAFETY:
// `buffer` содержит UnsafeCell, однако доступ к каждому элементу
// синхронизирован через head/tail:
//
// Producer:
//   - читает tail через Acquire;
//   - пишет слот;
//   - публикует head через Release.
//
// Consumer:
//   - читает head через Acquire;
//   - читает слот;
//   - освобождает слот через Release.
//
// При соблюдении SPSC-контракта один слот никогда одновременно
// не читается и не записывается.
unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
    /// Создаёт пустой SPSC ring buffer.
    ///
    /// # Panics
    ///
    /// Паникует, если `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "capacity must be > 0");

        let mut slots = Vec::with_capacity(capacity);

        for _ in 0..capacity {
            slots.push(UnsafeCell::new(MaybeUninit::uninit()));
        }

        Self {
            buffer: slots.into_boxed_slice(),
            capacity,

            head: CachePadded::new(AtomicUsize::new(0)),
            tail: CachePadded::new(AtomicUsize::new(0)),
        }
    }

    // ========================================================================
    // Producer
    // ========================================================================

    /// Пытается добавить элемент.
    ///
    /// `Ok(())` — элемент добавлен.
    ///
    /// `Err(value)` — буфер заполнен, исходный элемент возвращается.
    ///
    /// Не блокируется и не ждёт освобождения места.
    #[inline]
    pub fn push(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        // Producer владеет head, поэтому Relaxed достаточно.
        let head = self.head.load(Ordering::Relaxed);

        // Читаем актуальный tail consumer'а.
        //
        // Acquire гарантирует, что producer увидит освобождённые consumer'ом
        // слоты до повторного использования.
        let tail = self.tail.load(Ordering::Acquire);

        // Количество занятых элементов.
        let used = head.wrapping_sub(tail);

        // Буфер полностью заполнен.
        if used >= self.capacity {
            return Err(value);
        }

        let index = head % self.capacity;

        // Единственный producer владеет этим слотом.
        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Публикуем новый head только ПОСЛЕ записи данных.
        //
        // Consumer с Acquire гарантированно увидит полностью записанный Vec.
        self.head
            .store(head.wrapping_add(1), Ordering::Release);

        Ok(())
    }

    /// Пытается добавить элемент в начало буфера.
    ///
    /// `Ok(())` — элемент добавлен первым.
    /// `Err(value)` — буфер заполнен, исходный элемент возвращается.
    ///
    /// Не блокируется и не ждёт освобождения места.
    ///
    /// Важно: метод должен вызываться только producer'ом.
    #[inline]
    pub fn push_up(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        // Текущая позиция producer'а.
        let head = self.head.load(Ordering::Relaxed);

        // Текущая позиция consumer'а.
        let tail = self.tail.load(Ordering::Acquire);

        // Проверяем заполненность.
        let used = head.wrapping_sub(tail);

        if used >= self.capacity {
            return Err(value);
        }

        // Новый элемент должен оказаться перед текущим первым элементом.
        //
        // Например:
        // tail = 5
        // head = 8
        //
        // Логические элементы находятся в позициях:
        // 5, 6, 7
        //
        // После push_up новый tail будет 4.
        let new_tail = tail.wrapping_sub(1);
        let index = new_tail % self.capacity;

        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Публикуем новый tail после записи.
        self.tail.store(new_tail, Ordering::Release);

        Ok(())
    }

    /// Добавляет несколько элементов в очередь за один вызов.
    ///
    /// Резервирует до `free` слотов за раз и записывает элементы напрямую,
    /// без CAS на каждый пакет. Это эффективнее, чем серия одиночных `push`,
    /// но подразумевает **единственного производителя** — параллельная запись
    /// из нескольких потоков не защищена.
    ///
    /// # Стратегия
    /// 1. Под `Relaxed`-чтением `head` и `Acquire`-чтением `tail` вычисляется
    ///    количество свободных слотов `free`.
    /// 2. Из входного итератора берётся не более `free` элементов.
    /// 3. Каждый непустой элемент записывается в слот `(head + count) % capacity`.
    /// 4. Один раз под `Release` публикуется обновлённый `head`.
    ///
    /// Пустые `Vec<u8>` пропускаются и не занимают слот.
    ///
    /// # Аргументы
    /// * `values` — итератор по пакетам для добавления.
    ///
    /// # Возвращаемое значение
    /// Количество **фактически добавленных** элементов (без учёта пустых).
    /// Может быть меньше числа элементов в итераторе, если очередь заполнилась.
    #[inline]
    pub fn push_many<I>(&self, values: I) -> usize
    where
        I: IntoIterator<Item = Vec<u8>>,
    {
        // Текущие позиции головы и хвоста.
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);

        // Число занятых слотов (wrapping-разность).
        let used = head.wrapping_sub(tail);
        // Свободные слоты (защита от переполнения через saturating_sub).
        let free = self.capacity.saturating_sub(used);

        // Если очередь заполнена — выходим.
        if free == 0 {
            return 0;
        }

        // Счётчик успешно добавленных пакетов.
        let mut count = 0;

        // Берём не более `free` элементов из итератора.
        for value in values.into_iter().take(free) {
            // Пустые пакеты не занимают слот.
            if value.is_empty() {
                continue;
            }

            // Индекс слота для текущего пакета.
            let index = head.wrapping_add(count) % self.capacity;

            // Пишем в слот без дополнительной синхронизации — слот гарантированно
            // свободен, поскольку мы уже посчитали `free` и не превышаем его.
            unsafe {
                (*self.buffer[index].get()).write(value);
            }

            count += 1;
        }

        // Публикуем новое значение head один раз, если что-то записали.
        if count != 0 {
            self.head.store(
                head.wrapping_add(count),
                Ordering::Release,
            );
        }

        count
    }

    // ========================================================================
    // Consumer
    // ========================================================================

    /// Извлекает один элемент из очереди.
    ///
    /// Возвращает `None`, если на момент вызова очередь пуста.
    /// `Some(Vec<u8>)` при успешном извлечении.
    ///
    /// # Потокобезопасность
    /// Предполагается **единственный consumer**: загрузка `tail` идёт как `Relaxed`,
    /// а обновление `tail` под `Release` не защищено CAS. При параллельном чтении
    /// из нескольких потоков возможно дублирование извлечения одного и того же
    /// элемента.
    ///
    /// # Порядок синхронизации
    /// - `head` читается под `Acquire`, чтобы гарантированно увидеть данные,
    ///   опубликованные producer'ом под `Release`.
    /// - `tail` обновляется под `Release`, чтобы producer под `Acquire` увидел
    ///   освобождение слота и мог его переиспользовать.
    #[inline]
    pub fn pop(&self) -> Option<Vec<u8>> {
        // Consumer владеет tail — можно читать под Relaxed.
        let tail = self.tail.load(Ordering::Relaxed);

        // Acquire гарантирует видимость данных после Release-записи head.
        let head = self.head.load(Ordering::Acquire);

        // Очередь пуста.
        if tail == head { return None; }

        // Индекс слота в массиве.
        let index = tail % self.capacity;

        // Consumer — единственный владелец этого элемента, конкурентов нет.
        // Читаем значение из MaybeUninit, перенося владение наружу.
        let value = unsafe {
            (*self.buffer[index].get()).assume_init_read()
        };

        // Публикуем освобождение слота под Release:
        // producer под Acquire увидит новый tail и сможет переиспользовать слот.
        self.tail
            .store(tail.wrapping_add(1), Ordering::Release);

        Some(value)
    }

    /// Извлекает до `limit` элементов из очереди за один вызов.
    ///
    /// В отличие от одиночного `pop`, этот метод сначала снимает один снимок
    /// `head` и вычисляет реальное число доступных элементов, после чего
    /// читает их подряд без промежуточных атомарных операций.
    ///
    /// # Особенности
    /// - не ждёт и не блокируется;
    /// - если элементов меньше `limit`, возвращает только доступные;
    /// - если очередь пуста, ничего не пишет в `out`;
    /// - освобождение слотов публикуется одним `Release`-store, что дешевле
    ///   серии одиночных `pop`.
    ///
    /// # Потокобезопасность
    /// Предполагается **единственный consumer**. Параллельное извлечение из
    /// нескольких потоков не защищено и может привести к дублированию.
    ///
    /// # Аргументы
    /// * `out` — целевой вектор, куда помещаются извлечённые элементы.
    /// * `limit` — максимальное число извлекаемых элементов.
    #[inline]
    pub fn pop_many(&self, out: &mut Vec<Vec<u8>>, limit: usize) {
        // Нулевой лимит — нечего извлекать.
        if limit == 0 { return; }

        // Consumer владеет tail — можно читать под Relaxed.
        let tail = self.tail.load(Ordering::Relaxed);

        // Один snapshot головы под Acquire, чтобы увидеть все опубликованные данные.
        let head = self.head.load(Ordering::Acquire);

        // Сколько элементов реально доступно прямо сейчас.
        // wrapping_sub защищает от гонки при переполнении счётчиков,
        // min(capacity) ограничивает значение сверху.
        let available = head
            .wrapping_sub(tail)
            .min(self.capacity);

        // Никогда не читаем больше запрошенного.
        let count = available.min(limit);

        // Нечего извлекать.
        if count == 0 { return; }

        // Заранее резервируем место в выходном векторе.
        out.reserve(count);

        // Читаем `count` элементов подряд, начиная с текущего tail.
        for offset in 0..count {
            // Индекс очередного слота в массиве.
            let index = tail
                .wrapping_add(offset)
                % self.capacity;

            // Consumer — единственный владелец, конкуренции нет.
            // Переносим владение из MaybeUninit наружу.
            let value = unsafe {
                (*self.buffer[index].get()).assume_init_read()
            };

            out.push(value);
        }

        // Публикуем освобождение всех извлечённых слотов одним store.
        // Producer под Acquire увидит новый tail и сможет переиспользовать диапазон.
        self.tail.store(
            tail.wrapping_add(count),
            Ordering::Release,
        );
    }

    /// Освобождает все элементы и сжимает хранилище до `new_capacity` слотов.
    ///
    /// # ВАЖНО
    /// Требует `&mut self`, то есть должен вызываться только когда producer
    /// и consumer гарантированно остановлены (как и `clear()`). В этот момент
    /// во всём процессе нет других ссылок на буфер, поэтому переаллокация
    /// backing-массива безопасна.
    ///
    /// # Panics
    /// Паникует, если `new_capacity == 0`.
    pub fn shrink_to(&mut self, new_capacity: usize) {
        // Сначала дропаем живые элементы (освобождаем их кучи).
        self.clear();

        // Уже меньше или равно — нечего сжимать.
        if new_capacity >= self.capacity {
            return;
        }

        // Готовим новый, меньший backing-массив.
        let mut slots = Vec::with_capacity(new_capacity);
        for _ in 0..new_capacity {
            slots.push(UnsafeCell::new(MaybeUninit::uninit()));
        }

        // Заменяем старый Box — старая память возвращается аллокатору сразу.
        // Старые слоты уничтожаются как MaybeUninit — деструктор не вызывается,
        // что корректно, так как clear() уже дропнул всё живое.
        self.buffer = slots.into_boxed_slice();
        self.capacity = new_capacity;

        // После clear() счётчики уже 0, но оставим явно для читаемости.
        self.head.store(0, Ordering::Relaxed);
        self.tail.store(0, Ordering::Relaxed);
    }

    /// Сжимает хранилище до минимально возможного размера (1 слот),
    /// возвращая куче всю backing-память.
    ///
    /// Семантика как у `Vec::shrink_to_fit`: длина после `clear()` = 0,
    /// поэтому остаётся один слот — минимально рабочее состояние.
    ///
    /// # ВАЖНО
    /// Требует `&mut self` — только для остановленного буфера.
    pub fn shrink_to_fit(&mut self) {
        self.shrink_to(1);
    }

    // ========================================================================
    // State
    // ========================================================================

    /// Возвращает текущее количество занятых слотов.
    ///
    /// Значение — мгновенный snapshot: при конкурентном доступе оно может
    /// устареть сразу после возврата. Используется для метрик и грубых проверок.
    #[inline]
    pub fn len(&self) -> usize {
        // Acquire на обоих счётчиках — хотим видеть согласованное состояние
        // публикаций и освобождений слотов.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        // wrapping_sub защищает от переполнения счётчиков.
        // min(capacity) ограничивает значение сверху при гонке.
        head.wrapping_sub(tail).min(self.capacity)
    }

    /// Возвращает количество свободных слотов для записи.
    ///
    /// Используется producer'ом для оценки, сколько элементов можно
    /// добавить без ожидания освобождения места.
    #[inline]
    pub fn free_slots(&self) -> usize {
        // head читается под Relaxed — его пишет только producer.
        let head = self.head.load(Ordering::Relaxed);
        // tail читается под Acquire — важно увидеть освобождения consumer'а.
        let tail = self.tail.load(Ordering::Acquire);

        // Занятые слоты с защитой от переполнения и гонки.
        let used = head.wrapping_sub(tail).min(self.capacity);

        // Свободные слоты.
        self.capacity - used
    }

    /// Проверяет, пуст ли буфер.
    ///
    /// Snapshot-проверка: результат может устареть сразу после возврата.
    #[inline]
    pub fn is_empty(&self) -> bool {
        // Оба счётчика под Acquire — нужна согласованная картина.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);

        // Пусто, когда позиции головы и хвоста совпадают.
        head == tail
    }

    /// Проверяет, заполнен ли буфер полностью.
    ///
    /// Snapshot-проверка: если результат `true`, следующий `push` может
    /// всё ещё пройти, если consumer успел освободить слот.
    #[inline]
    pub fn is_full(&self) -> bool {
        // head — только под Relaxed (это поле producer'а).
        let head = self.head.load(Ordering::Relaxed);
        // tail под Acquire — важно увидеть освобождения от consumer'а.
        let tail = self.tail.load(Ordering::Acquire);

        // Разница не меньше ёмкости — все слоты заняты.
        head.wrapping_sub(tail) >= self.capacity
    }

    // ========================================================================
    // Maintenance
    // ========================================================================

    /// Полностью очищает буфер.
    ///
    /// ВАЖНО:
    /// Должен вызываться только после остановки producer и consumer.
    pub fn clear(&self) {
        let tail = self.tail.load(Ordering::Relaxed);
        let head = self.head.load(Ordering::Relaxed);

        let count = head
            .wrapping_sub(tail)
            .min(self.capacity);

        // Дропаем только реально занятые слоты.
        for offset in 0..count {
            let index = tail
                .wrapping_add(offset)
                % self.capacity;

            unsafe {
                (*self.buffer[index].get())
                    .assume_init_drop();
            }
        }

        // После полной остановки потоков можно сбросить индексы.
        self.head.store(0, Ordering::Relaxed);
        self.tail.store(0, Ordering::Relaxed);
    }
}

impl Drop for RingBuffer {
    fn drop(&mut self) {
        // Очищаем буфер: дропаем все элементы в диапазоне [tail, head)
        // и сбрасываем счётчики в исходное состояние.
        self.clear();
    }
}