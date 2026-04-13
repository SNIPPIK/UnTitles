/**
 * @author SNIPPIK
 * @description Слой связующий разные методы подключения и прочее в 1 транспортный класс
 * @class BaseLayer
 * @abstract
 * @public
 */
export abstract class BaseLayer<T> {
    public static MAX_RETRIES = 3;

    public get ready() {
        return false;
    };

    public packet = (..._: any): T => {
        throw new TypeError("Not found packet function");
    };

    public create = (..._: any[]): void => {
        throw new TypeError("Not found create function");
    };

    public destroy = (): void => {
        throw new TypeError("Not found destroy function");
    };
}