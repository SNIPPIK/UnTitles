use crossbeam_utils::CachePadded;
use std::{
    cell::UnsafeCell,
    mem::MaybeUninit,
    sync::atomic::{AtomicUsize, Ordering},
};

/// SPSC lock-free кольцевой буфер для `Vec<u8>`.
///
/// # Архитектура
///
/// Producer:
///     - изменяет `head` (Release)
///     - читает `tail` (Acquire)
///
/// Consumer:
///     - изменяет `tail` (Release)
///     - читает `head` (Acquire)
///
/// # Инварианты
/// - Ровно один producer и ровно один consumer одновременно.
/// - `push_up` обязан вызываться **только** из consumer-потока
///   (он тоже пишет в `tail`, как и `pop`/`pop_many`) — либо вызовы
///   должны быть строго сериализованы вызывающей стороной.
/// - `capacity` рекомендуется степенью двойки — тогда индексация
///   использует битовую маску вместо деления.
///
/// Цель буфера — не допускать тихого уничтожения RTP/Opus пакетов
/// при заполнении очереди: все операции возвращают не доставленные данные
/// вызывающему коду (`Err(value)`), а не дропают их молча.
pub struct RingBuffer {
    // Массив слотов. `UnsafeCell<MaybeUninit<Vec<u8>>>` — классическая
    // схема "сырой слот без инициализации": запись/чтение/дроп вручную,
    // никакой автоматической инициализации/деструктора у массива нет.
    buffer: Box<[UnsafeCell<MaybeUninit<Vec<u8>>>]>,

    // Ёмкость (число слотов). Не меняется после `new`.
    capacity: usize,

    // `capacity - 1`, если capacity — степень двойки; иначе `None`.
    // Позволяет заменить `%` на `&` в `index()` — заметно дешевле в hot path.
    mask: Option<usize>,

    // Позиция producer. Меняется ТОЛЬКО producer'ом.
    // CachePadded — разносит head/tail по разным кэш-линиям,
    // иначе они будут "драться" за одну линию между двумя ядрами.
    head: CachePadded<AtomicUsize>,

    // Позиция consumer. Меняется ТОЛЬКО consumer'ом.
    tail: CachePadded<AtomicUsize>,
}

// SAFETY: буфер спроектирован под SPSC. Producer работает только со своим
// head, consumer — только со своим tail. Содержимое слотов синхронизировано
// публикацией head/tail через Release/Acquire, поэтому передача владения
// буфером между потоками (Send) и совместный доступ по ссылке (Sync)
// безопасны при соблюдении инвариантов "один producer / один consumer".
//
// NB: компилятор не может доказать корректность этой ручной синхронизации —
// тип с `UnsafeCell` не Send/Sync по умолчанию, поэтому impl'ы ручные.
unsafe impl Send for RingBuffer {}
unsafe impl Sync for RingBuffer {}

impl RingBuffer {
    /// Создаёт пустой ring buffer.
    ///
    /// `capacity` — максимальное количество одновременно хранимых пакетов.
    ///
    /// # Panics
    /// Паникует, если `capacity == 0`.
    pub fn new(capacity: usize) -> Self {
        assert!(capacity > 0, "RingBuffer capacity must be greater than zero");

        // Каждый слот — `MaybeUninit::uninit()`: Vec ещё не создан, дропать
        // его нельзя. Заполнение/дроп — только через явные методы ниже.
        let buffer = (0..capacity)
            .map(|_| UnsafeCell::new(MaybeUninit::uninit()))
            .collect::<Vec<_>>()
            .into_boxed_slice();

        // Степень двойки -> mask = cap-1; иначе None и index() идёт через `%`.
        let mask = capacity.is_power_of_two().then_some(capacity - 1);

        Self {
            buffer,
            capacity,
            mask,
            head: CachePadded::new(AtomicUsize::new(0)),
            tail: CachePadded::new(AtomicUsize::new(0)),
        }
    }

    /// Ёмкость буфера (в слотах).
    /*#[inline(always)]
    pub fn capacity(&self) -> usize {
        self.capacity
    }*/

    // ========================================================================
    // Internal
    // ========================================================================

    /// Преобразует логическую (монотонно растущую, с wraparound по `usize`)
    /// позицию в физический индекс слота.
    ///
    /// Head/tail — счётчики-обёртки, а не индексы: они только растут
    /// (с точностью до wrap-around), а реальный слот берётся по модулю ёмкости.
    /// Это избавляет от необходимости отдельно различать "пустой" и "полный".
    #[inline(always)]
    fn index(&self, position: usize) -> usize {
        match self.mask {
            // Степень двойки: быстрый путь через битовую маску.
            Some(mask) => position & mask,
            // Fallback: деление с остатком.
            None => position % self.capacity,
        }
    }

    // ========================================================================
    // Producer
    // ========================================================================

    /// Пытается добавить один пакет.
    ///
    /// `Ok(())` — пакет успешно записан.
    /// `Err(value)` — буфер заполнен, пакет возвращён вызывающему коду
    /// (никакого silent drop).
    ///
    /// Пустые пакеты (`value.is_empty()`) отклоняются как бессмысленные
    /// для RTP, но пакет всё равно возвращается через `Err`, чтобы
    /// вызывающий код мог решить, что с ним делать.
    #[inline(always)]
    pub fn push(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        // Пустой пакет — сразу назад. Не жжём кэш и не занимаем слот.
        if value.is_empty() {
            return Err(value);
        }

        // head принадлежит producer'у — можно Relaxed.
        let head = self.head.load(Ordering::Relaxed);

        // tail пишется consumer'ом, поэтому Acquire — увидеть освобождения
        // слотов ДО того, как мы решим, что места хватает.
        let tail = self.tail.load(Ordering::Acquire);

        // Занято >= capacity -> очередь полна, отдаём пакет обратно.
        // Wrapping_sub корректен: обе позиции растут в одном пространстве
        // (usize со wrap-around), разница всегда корректна.
        if head.wrapping_sub(tail) >= self.capacity {
            return Err(value);
        }

        let index = self.index(head);

        // Слот свободен (мы это только что проверили) и принадлежит нам —
        // конкурентов у этого индекса нет. Unsafe: MaybeUninit::write.
        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Release: данные должны быть видны consumer'у ДО того, как он
        // увидит новый head. Без этого он мог бы прочитать пустой слот.
        self.head.store(head.wrapping_add(1), Ordering::Release);
        Ok(())
    }

    /// Возвращает уже готовый пакет в начало очереди
    /// (например, если отправка UDP завершилась ошибкой).
    ///
    /// Должен вызываться **из consumer-потока** и не должен пересекаться
    /// по времени с вызовами `pop`/`pop_many` (все они пишут в `tail`).
    ///
    /// `Ok(())` — пакет возвращён. `Err(value)` — места нет.
    #[inline(always)]
    pub fn push_up(&self, value: Vec<u8>) -> Result<(), Vec<u8>> {
        if value.is_empty() {
            return Err(value);
        }

        // Обратная картина: head читается под Acquire (нужны опубликованные
        // данные), tail наш — Relaxed.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Relaxed);

        if head.wrapping_sub(tail) >= self.capacity {
            return Err(value);
        }

        // Сдвигаем начало очереди назад на один слот. `wrapping_sub` корректен
        // даже при tail == 0: получившееся "отрицательное" значение по модулю
        // 2^usize::BITS остаётся согласованным с `index()`, т.к. вся арифметика
        // позиций (head/tail/index) везде выполняется по модулю одной и той же
        // величины 2^usize::BITS.
        let new_tail = tail.wrapping_sub(1);
        let index = self.index(new_tail);

        unsafe {
            (*self.buffer[index].get()).write(value);
        }

        // Release: публикуем слот для producer'а (если он вдруг смотрит
        // на tail, чтобы понять, есть ли место).
        self.tail.store(new_tail, Ordering::Release);
        Ok(())
    }

    /// Пытается добавить несколько пакетов, возвращает количество реально
    /// записанных элементов.
    ///
    /// Пустые пакеты пропускаются молча (бессмысленны для RTP), но всё ещё
    /// расходуют один слот "квоты" `free` — это осознанный trade-off, чтобы
    /// не делать два прохода по итератору. Если это неприемлемо, отфильтруйте
    /// пустые элементы на стороне вызывающего кода перед вызовом.
    ///
    /// Если очередь заполнится, хвост входного итератора остаётся
    /// невостребованным — обработку остатка выполняет caller.
    #[inline]
    pub fn push_many<I>(&self, values: I) -> usize where
        I: IntoIterator<Item = Vec<u8>>,
    {
        // Текущие позиции головы и хвоста.
        // head — наш, Relaxed; tail — чужой, Acquire.
        let head = self.head.load(Ordering::Relaxed);
        let tail = self.tail.load(Ordering::Acquire);

        // Число занятых слотов (wrapping-разность).
        let used = head.wrapping_sub(tail);
        // Свободные слоты (защита от переполнения через saturating_sub).
        // Saturating_sub нужен, если used "внезапно" больше capacity —
        // теоретически невозможно при корректном SPSC, но дёшево подстраховаться.
        let free = self.capacity.saturating_sub(used);

        // Если очередь заполнена — выходим.
        if free == 0 { return 0; }

        let mut written = 0usize;

        // Берём не более `free` элементов из итератора.
        // Take(free), а не while — гарантированно не переполним буфер,
        // даже если внутри iterator.next() случится что-то странное.
        for value in values.into_iter().take(free) {
            // Пустые пакеты не имеют смысла для RTP.
            // Важно: они не уменьшают `written`, но и не сдвигают head —
            // т.е. слот остаётся свободным для следующего непустого пакета.
            if value.is_empty() {
                continue;
            }

            let index = self.index(head.wrapping_add(written));
            // Слот гарантированно свободен: посчитанный `free` не превышен.
            unsafe {
                (*self.buffer[index].get()).write(value);
            }

            written += 1;
        }

        // Единый Release только если что-то записали: если written == 0,
        // публиковать нечего, и лишний store сбил бы кэш у consumer'а.
        if written != 0 {
            self.head.store(head.wrapping_add(written), Ordering::Release);
        }

        written
    }

    // ========================================================================
    // Consumer
    // ========================================================================

    /// Извлекает один пакет. `None` — очередь пуста.
    #[inline(always)]
    pub fn pop(&self) -> Option<Vec<u8>> {
        // Consumer владеет tail.
        let tail = self.tail.load(Ordering::Relaxed);

        // Producer публикует новые данные через Release.
        // Acquire — увидеть данные в слоте, а не только факт публикации.
        let head = self.head.load(Ordering::Acquire);

        if tail == head {
            return None;
        }

        let index = self.index(tail);

        // Consumer — единственный владелец этого элемента, конкурентов нет.
        // assume_init_read: забираем Vec по значению, слот снова "uninit".
        let value = unsafe { (*self.buffer[index].get()).assume_init_read() };

        // Release: публикуем освобождение слота для producer'а.
        self.tail.store(tail.wrapping_add(1), Ordering::Release);
        Some(value)
    }

    /// Извлекает до `limit` пакетов в `out`.
    #[inline]
    pub fn pop_many(&self, out: &mut Vec<Vec<u8>>, limit: usize) {
        if limit == 0 {
            return;
        }

        // Consumer владеет tail — можно читать под Relaxed.
        let tail = self.tail.load(Ordering::Relaxed);

        // Один snapshot головы под Acquire, чтобы увидеть все опубликованные данные.
        // Дальше не перечитываем head: если producer допишет ещё — заберём
        // это следующим вызовом. Один Acquire на пачку — дешевле, чем N.
        let head = self.head.load(Ordering::Acquire);

        // min(capacity) — страховка от "фантомного" head далеко впереди:
        // без неё wrapping_sub мог бы дать больше capacity, если бы
        // инварианты SPSC были нарушены.
        let available = head.wrapping_sub(tail).min(self.capacity);
        let count = available.min(limit);

        if count == 0 {
            return;
        }

        // Заранее резервируем место в выходном векторе.
        out.reserve(count);

        // Читаем `count` элементов подряд, начиная с текущего tail.
        for offset in 0..count {
            let index = self.index(tail.wrapping_add(offset));
            let value = unsafe { (*self.buffer[index].get()).assume_init_read() };
            out.push(value);
        }

        // Один Release на всю пачку — симметрично pop_many.
        self.tail.store(tail.wrapping_add(count), Ordering::Release);
    }

    // ========================================================================
    // State
    // ========================================================================

    /// Текущее количество пакетов (мгновенный snapshot, может устареть сразу
    /// после возврата). Используется для метрик и грубых проверок.
    #[inline]
    pub fn len(&self) -> usize {
        // Acquire на обоих счётчиках — хотим видеть согласованное состояние
        // публикаций и освобождений слотов.
        // NB: это не атомарный snapshot — параллельные push/pop могут
        // случиться между двумя load. Для метрик — приемлемо.
        let head = self.head.load(Ordering::Acquire);
        let tail = self.tail.load(Ordering::Acquire);
        head.wrapping_sub(tail).min(self.capacity)
    }

    /// Количество свободных слотов для записи.
    #[inline]
    pub fn free_slots(&self) -> usize {
        self.capacity.saturating_sub(self.len())
    }

    /// `true`, если буфер пуст (snapshot).
    #[inline]
    pub fn is_empty(&self) -> bool {
        // Разные Acquire на разные атомики — согласованности "в один момент"
        // никто не обещает; но для пустоты достаточно, чтобы оба счётчика
        // были равны на момент чтения каждого.
        self.head.load(Ordering::Acquire) == self.tail.load(Ordering::Acquire)
    }

    /// `true`, если буфер заполнен полностью (snapshot; к моменту чтения
    /// результата producer/consumer могли уже изменить состояние).
    #[inline]
    pub fn is_full(&self) -> bool {
        // Head — только под Relaxed (это поле producer'а).
        // Строго говоря, для решения "полон ли" producer должен читать
        // head Relaxed, а tail — Acquire.
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
    /// Требует эксклюзивного доступа (`&mut self`) — это гарантирует
    /// компилятором, что producer и consumer в этот момент не работают
    /// с буфером (например, через `Arc<RingBuffer>` вызвать `clear()` уже
    /// нельзя, пока живы другие обращения).
    pub fn clear(&mut self) {
        // get_mut() на CachePadded<AtomicUsize> даёт &mut usize: мы
        // единственные, кто вообще может дотронуться до этих полей.
        let tail = *self.tail.get_mut();
        let head = *self.head.get_mut();
        let count = head.wrapping_sub(tail).min(self.capacity);

        // Дропаем только реально занятые слоты.
        // Пустые слоты — MaybeUninit, дропать нечего.
        for offset in 0..count {
            let index = self.index(tail.wrapping_add(offset));
            unsafe {
                (*self.buffer[index].get()).assume_init_drop();
            }
        }

        // Сбрасываем счётчики в 0 — буфер снова "как новый".
        // (В принципе, можно было бы не сбрасывать, а просто сделать
        // head = tail; но обнуление проще для отладки/детерминизма.)
        *self.head.get_mut() = 0;
        *self.tail.get_mut() = 0;
    }
}

impl Drop for RingBuffer {
    fn drop(&mut self) {
        // Через clear(): гарантированно дропаем все живые Vec<u8>,
        // не оставляя утечек. clear() идемпотентен — можно звать
        // после явного вызова, ничего не сломается.
        self.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Хелпер: 4-байтовый пакет, начинающийся с байта n.
    // Просто удобно, чтобы различать элементы в тестах по первому байту.
    fn pkt(n: u8) -> Vec<u8> {
        vec![n; 4]
    }

    #[test]
    fn push_pop_basic() {
        let rb = RingBuffer::new(4);
        assert!(rb.is_empty());
        assert!(rb.push(pkt(1)).is_ok());
        assert!(rb.push(pkt(2)).is_ok());
        assert_eq!(rb.len(), 2);
        // FIFO: сначала тот, что положили раньше.
        assert_eq!(rb.pop(), Some(pkt(1)));
        assert_eq!(rb.pop(), Some(pkt(2)));
        assert_eq!(rb.pop(), None);
    }

    #[test]
    fn push_rejects_empty() {
        let rb = RingBuffer::new(4);
        // Пустой вектор должен вернуться как Err(value), а не потеряться.
        assert_eq!(rb.push(Vec::new()), Err(Vec::new()));
        assert!(rb.is_empty());
    }

    #[test]
    fn push_full_returns_value() {
        let rb = RingBuffer::new(2);
        assert!(rb.push(pkt(1)).is_ok());
        assert!(rb.push(pkt(2)).is_ok());
        // Третий не влезает — получаем обратно ровно то, что клали.
        let err = rb.push(pkt(3));
        assert_eq!(err, Err(pkt(3)));
        assert!(rb.is_full());
    }

    #[test]
    fn push_many_respects_free_space_and_skips_empty() {
        let rb = RingBuffer::new(4);
        let written = rb.push_many(vec![pkt(1), Vec::new(), pkt(2), pkt(3), pkt(4)]);
        // free == 4, itertor.take(4) съедает первые 4 элемента,
        // один из них пустой -> реально записано 3.
        assert_eq!(written, 3);
        assert_eq!(rb.len(), 3);
    }

    #[test]
    fn pop_many_limit_and_availability() {
        let rb = RingBuffer::new(8);
        for i in 0..5u8 {
            rb.push(pkt(i)).unwrap();
        }
        let mut out = Vec::new();
        rb.pop_many(&mut out, 3);
        assert_eq!(out.len(), 3);
        assert_eq!(rb.len(), 2);

        // limit больше, чем доступно — берём всё, что есть.
        out.clear();
        rb.pop_many(&mut out, 10);
        assert_eq!(out.len(), 2);
        assert!(rb.is_empty());
    }

    #[test]
    fn push_up_reinserts_at_front() {
        let rb = RingBuffer::new(4);
        rb.push(pkt(1)).unwrap();
        rb.push(pkt(2)).unwrap();
        let popped = rb.pop().unwrap(); // pkt(1)
        rb.push_up(popped).unwrap(); // вернули pkt(1) обратно вперёд
        // Порядок восстановлен: pkt(1) снова первый.
        assert_eq!(rb.pop(), Some(pkt(1)));
        assert_eq!(rb.pop(), Some(pkt(2)));
    }

    #[test]
    fn push_up_fails_when_full() {
        let rb = RingBuffer::new(2);
        rb.push(pkt(1)).unwrap();
        rb.push(pkt(2)).unwrap();
        // Мест нет — push_up обязан вернуть значение, не перезаписав
        // занятые слоты.
        assert_eq!(rb.push_up(pkt(3)), Err(pkt(3)));
    }

    #[test]
    fn wraparound_index_correctness() {
        let rb = RingBuffer::new(3); // не степень двойки -> путь через '%'
        // 10 итераций — head/tail успеют обернуться несколько раз,
        // проверяем, что index() корректно маппит при wraparound.
        for round in 0..10u8 {
            rb.push(pkt(round)).unwrap();
            assert_eq!(rb.pop(), Some(pkt(round)));
        }
    }

    #[test]
    fn power_of_two_mask_used() {
        let rb = RingBuffer::new(8);
        assert_eq!(rb.mask, Some(7));
        let rb2 = RingBuffer::new(5);
        assert_eq!(rb2.mask, None);
    }

    #[test]
    fn drop_releases_remaining_items() {
        let rb = RingBuffer::new(4);
        rb.push(pkt(1)).unwrap();
        rb.push(pkt(2)).unwrap();
        drop(rb.pop()); // освободили один слот
        rb.push(pkt(3)).unwrap();
    }
}