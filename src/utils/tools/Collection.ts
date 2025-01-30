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
    private readonly map = new Map<T, K>();

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: T) => { return this.map.get(ID); };

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
            this.map.set(ID, value);
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
        const item: any = this.map.get(ID);

        // Если найден объект, то удаляем все сопутствующее, если это возможно
        if (item) {
            if ("disconnect" in item) item?.disconnect();
            if ("cleanup" in item) item?.cleanup();
            if ("destroy" in item) item?.destroy();

            this.map.delete(ID);
        }

        return;
    };

    /**
     * @description Получаем случайный объект из класса MAP
     * @public
     */
    public get random(): K {
        const keys = Array.from(this.map.keys());
        const key = keys[Math.floor(Math.random() * keys.length)];

        return this.get(key);
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() { return this.map.size; };
}