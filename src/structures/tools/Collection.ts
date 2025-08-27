/**
 * @author SNIPPIK
 * @description Коллекция
 * @abstract
 * @public
 */
export class Collection<K, T = string> {
    /**
     * @description База Map для взаимодействия с объектами через идентификатор
     * @readonly
     * @private
     */
    private readonly _map = new Map<T, K>();

    /**
     * @description Получаем случайный объект из MAP
     * @public
     */
    public get array(): K[] {
        return this._map.values().toArray();
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @returns number
     * @public
     */
    public get size(): number {
        return this._map.size;
    };

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @returns K
     * @public
     */
    public get = (ID: T): K => {
        return this._map.get(ID);
    };

    /**
     * @description Добавляем объект в список
     * @param ID - ID объекта
     * @param value - Объект для добавления
     * @param promise - Если надо сделать действие с объектом
     * @returns K
     * @public
     */
    public set = (ID: T, value: K, promise?: (item: K) => void): K => {
        const item = this.get(ID);

        // Если нет объекта, то добавляем его
        if (!item) {
            promise?.(value);
            this._map.set(ID, value);
            return value;
        }

        // Выдаем объект
        return item;
    };

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @param silent - тихое удаление объекта
     * @returns void
     * @public
     */
    public remove = (ID: T, silent: boolean = false): void => {
        const item = this._map.get(ID);

        // Если не найден объект
        if (!item) return null;

        const cleanupMethods = silent ? ["silent_destroy"] : ["disconnect", "cleanup", "destroy"];
        // Если объект имеет функции удаления от они будут выполнены до удаления
        for (const key of cleanupMethods) {
            const fn = (item as any)[key];
            if (typeof fn === "function") fn.call(item);
        }

        this._map.delete(ID);
    };

    /**
     * @description Удаление всего из set/map
     * @public
     */
    public clear = (): void => {
        this._map.clear();
    };
}