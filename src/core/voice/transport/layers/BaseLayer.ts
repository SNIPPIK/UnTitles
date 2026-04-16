/**
 * @author SNIPPIK
 * @description Слой связующий разные методы подключения и прочее в 1 транспортный класс
 * @class BaseLayer
 * @abstract
 * @public
 */
export abstract class BaseLayer<T> {
    public static MAX_RETRIES = 3;

    protected _client: T;

    public get ready() {
        return false;
    };

    public create = (..._: any[]): void => {
        throw new TypeError("Not found create function");
    };

    public destroy = (): void => {
        throw new TypeError("Not found destroy function");
    };
}