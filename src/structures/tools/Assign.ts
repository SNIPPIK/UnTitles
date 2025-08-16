/**
 * @author SNIPPIK
 * @description Загрузчик классов
 * @class Assign
 * @abstract
 * @public
 */
export abstract class Assign<T extends object> {
    /**
     * @description Создаем команду
     * @param options Любые параметры указанные через T
     * @constructor
     * @protected
     */
    protected constructor(options: T) {
        Object.assign(this as this & T, options);
    };
}