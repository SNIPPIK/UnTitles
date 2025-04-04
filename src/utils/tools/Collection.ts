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
     * @description Получаем случайный объект из MAP
     * @public
     */
    public get array() {
        return this._map.values();
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
        return this._map.size;
    };

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: T) => this._map.get(ID);

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
     * @param silent - тихое удаление объекта
     * @public
     */
    public remove = (ID: T, silent: boolean = false) => {
        const item = this._map.get(ID);

        // Если найден объект, то удаляем все сопутствующее, если это возможно
        if (item) {

            // Если надо удалить тихо
            if (silent) {
                // Если объект имеет функции удаления от они будут выполнены до удаления
                for (const key of ["silent_destroy"]) {
                    if (item[key] && typeof item[key] === "function") item[`${key}`]();
                }
            } else {
                // Если объект имеет функции удаления от они будут выполнены до удаления
                for (const key of ["disconnect", "cleanup", "destroy"]) {
                    if (item[key] && typeof item[key] === "function") item[`${key}`]();
                }
            }

            this._map.delete(ID);
        }

        return;
    };
}