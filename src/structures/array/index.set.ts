/**
 * Гибридная коллекция, объединяющая свойства `Set<T>` и массива.
 *
 * Обеспечивает:
 * - **O(1)** добавление, удаление и проверку наличия элемента.
 * - **O(1)** получение элемента без поиска (возвращает сам элемент, если он есть).
 * - Стабильный порядок итерации (в порядке добавления).
 * - Доступ к внутреннему массиву только для чтения.
 * - Безопасную итерацию через копию массива.
 *
 * Удаление реализовано через "swap-remove": последний элемент перемещается
 * на место удаляемого, что не сохраняет порядок, но даёт O(1) сложность.
 *
 * @typeParam T - тип элементов коллекции.
 */
export class SetArray<T> {
    /**
     * Массив элементов. Порядок соответствует очерёдности добавления,
     * но может нарушаться при удалении (swap-remove).
     */
    private _array: T[] = [];

    /**
     * Хеш-таблица: ключ — элемент, значение — его индекс в `_array`.
     * Позволяет получать индекс за O(1), что критично для быстрого удаления.
     */
    private _indexMap = new Map<T, number>();

    /**
     * Доступ к внутреннему массиву только для чтения.
     * Модификация возможна только через методы класса.
     */
    public get array(): readonly T[] {
        return this._array;
    };

    /**
     * Добавляет элемент в коллекцию.
     *
     * Если элемент уже существует, метод игнорирует его и возвращает `this`.
     * Сложность: **O(1)** амортизированное (за счёт `Map.set` и `Array.push`).
     *
     * @param item - добавляемый элемент.
     * @returns `this` для цепочечных вызовов.
     */
    public add(item: T): this {
        if (this._indexMap.has(item)) return this;

        const index = this._array.length;
        this._array.push(item);
        this._indexMap.set(item, index);

        return this;
    };

    /**
     * Проверяет, содержится ли элемент в коллекции.
     * Сложность: **O(1)**.
     */
    public has(item: T): boolean {
        return this._indexMap.has(item);
    };

    /**
     * Удаляет элемент из коллекции.
     *
     * Использует "swap-remove": на место удаляемого элемента перемещается
     * последний, после чего массив укорачивается на 1.
     * Это **не сохраняет порядок** элементов, но даёт O(1) вместо O(n).
     *
     * @param item - удаляемый элемент.
     * @returns `true`, если элемент был удалён, иначе `false`.
     */
    public delete(item: T): boolean {
        const index = this._indexMap.get(item);
        if (index === undefined) return false;

        const lastIndex = this._array.length - 1;
        const lastItem = this._array[lastIndex];

        // Если удаляемый элемент не последний — меняем его с последним.
        if (index !== lastIndex) {
            this._array[index] = lastItem;
            this._indexMap.set(lastItem, index);
        }

        // Удаляем последний элемент и запись в мапе.
        this._array.pop();
        this._indexMap.delete(item);

        return true;
    };

    /**
     * Если элемент присутствует в коллекции, возвращает его,
     * иначе возвращает `null`.
     *
     * В отличие от `find`, не требует предиката и работает за O(1).
     */
    public get(item: T): T | null {
        return this._indexMap.has(item) ? item : null;
    };

    /**
     * Возвращает копию массива элементов.
     *
     * Безопасно для итерации с параллельным изменением коллекции,
     * так как возвращается снимок на момент вызова.
     */
    public values(): T[] {
        return this._array.slice();
    };

    /**
     * Фильтрует элементы коллекции через предикат.
     *
     * Не оптимизирован (O(n)), рекомендуется только для нечастых операций.
     */
    public filter(fn: (item: T) => boolean): T[] {
        return this._array.filter(fn);
    };

    /**
     * Находит первый элемент, удовлетворяющий предикату.
     *
     * Не оптимизирован (O(n)), рекомендуется только для нечастых операций.
     */
    public find(fn: (item: T) => boolean): T | undefined {
        return this._array.find(fn);
    };

    /**
     * Фильтрует элементы коллекции через предикат.
     *
     * Не оптимизирован (O(n)), рекомендуется только для нечастых операций.
     */
    public sort(fn: (a: T, b: T) => number): T[] {
        return this._array.sort(fn);
    };

    /**
     * Полностью очищает коллекцию.
     *
     * Сложность O(1) за счёт `array.length = 0` и `Map.clear()`.
     */
    public clear(): void {
        this._array = [];
        this._indexMap.clear();
    };

    /** Количество элементов в коллекции. */
    public get size(): number {
        return this._array.length;
    };
}