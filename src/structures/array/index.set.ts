/**
 * @author SNIPPIK
 * @description Реализация функция из Array в Set
 * @class SetArray
 * @extends Set
 * @public
 */
export class SetArray<T> extends Set<T> {
    /** Параметр со списком ссылок на объекты для использования функций Array */
    private _array: Array<T> = [];

    /**
     * @description Выдаем коллекцию... Для дальнейшего использования
     * @returns T[]
     * @public
     */
    public get array(): T[] {
        return this._array;
    };

    /**
     * @description Добавление задачи в базу
     * @param task - Задача
     * @public
     */
    public add(task: T) {
        if (this.has(task)) this.delete(task);

        // Если нет обьекта в списке
        if (this._array && !this._array?.includes?.(task)) this._array.push(task);

        // Стандартный метод добавления
        super.add(task);
        return this;
    };

    /**
     * @description Удаляет элемент из массива
     * @param item - объект задачи или item с next
     * @returns true если элемент найден и удалён, иначе false
     * @public
     */
    public delete(item: T) {
        const index = this.array.indexOf(item);

        // Если есть данный объект в списке
        if (index !== -1) {
            this._array.splice(index);
        }

        // Стандартный метод удаления
        super.delete(item);
        return true;
    };

    /**
     * @description Получаем объект из списка
     * @param item - оригинальный объект
     * @public
     */
    public get(item: T) {
        return this.has(item) ? item : null;
    };

    /**
     * @description Производим фильтрацию по функции
     * @param predicate - Функция поиска
     * @returns T[]
     * @public
     */
    public filter = (predicate: (item: T) => boolean): T[] => {
        return this.array.filter(predicate);
    };

    /**
     * @description Производим поиск объекта по функции
     * @param predicate - Функция поиска
     * @returns T[]
     * @public
     */
    public find = (predicate: (item: T) => boolean): T => {
        return this.array.find(predicate);
    };

    /**
     * @description Функция удаления данных из мульти класса
     * @public
     */
    public clear(): void {
        super.clear();

        // Удаления всех данных из списка
        this._array.splice(0, this._array.length);
        this._array = null;
    };
}