/**
 * @author SNIPPIK
 * @description Загрузчик классов
 * @class Assign
 * @abstract
 * @public
 */
export abstract class Assign<T> {
    /**
     * @description Создаем команду
     * @param options Любые параметры указанные через T
     * @protected
     */
    protected constructor(options: T) {
        Object.assign(this, options);
    };
}