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