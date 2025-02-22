/**
 * @author SNIPPIK
 * @description Коллекция
 * @abstract
 * @public
 */
export abstract class Collection<K, T = string> {
    /**
     * @description База Map для взаимодействия с объектами через идентификатор
     * @readonly
     * @private
     */
    private readonly _map = new Map<T, K>();

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: T) => {
        return this._map.get(ID);
    };

    /**
     * @description Добавляем объект в список
     * @param ID - ID объекта
     * @param value - Объект для добавления
     * @param promise - Если надо сделать действие с объектом
     * @public
     */
    public set = (ID: T, value: K, promise?: (item: K) => void) => {
        const item = this.get(ID);

        // Если нет объекта, то добавляем его
        if (!item) {
            if (promise) promise(value);
            this._map.set(ID, value);
            return value;
        }

        // Выдаем объект
        return item;
    };

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @public
     */
    public remove = (ID: T) => {
        const item = this._map.get(ID);

        // Если найден объект, то удаляем все сопутствующее, если это возможно
        if (item) {
            // Если объект имеет функции удаления от они будут выполнены до удаления
            for (const key of ["disconnect", "cleanup", "destroy"]) {
                if (item[key] && typeof item[key] === "function") item[`${key}`]();
            }

            this._map.delete(ID);
        }

        return;
    };

    /**
     * @description Получаем случайный объект из MAP
     * @public
     */
    public get random(): K {
        const keys = Array.from(this._map.keys());
        const key = keys[Math.floor(Math.random() * keys.length)];

        return this.get(key);
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
        return this._map.size;
    };
}