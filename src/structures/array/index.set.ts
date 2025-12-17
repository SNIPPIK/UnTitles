/**
 * @author SNIPPIK
 * @description Реализация функция из Array в Set
 * @class SetArray
 * @extends Set
 * @public
 */
export class SetArray<T> extends Set<T> {
    /**
     * @description Выдаем коллекцию... Для дальнейшего использования
     * @returns T[]
     * @public
     */
    public get array(): T[] {
        return Array.from(this.values());
    };

    /**
     * @description Добавление задачи в базу
     * @param task - Задача
     * @public
     */
    public add(task: T) {
        if (this.has(task)) this.delete(task);

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
        if (!this.has(item)) {
            this.delete(item);
            return true;
        }

        super.delete(item);
        return true;
    };

    /**
     * @description Получаем объект из списка
     * @param item - оригинальный объект
     * @public
     */
    public get(item: T) {
        const array = this.array;
        const index = array.indexOf(item);

        return index > -1 ? array[index] : null;
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
}