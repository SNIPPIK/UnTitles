import { EventEmitterAsyncResource } from "node:events";

/**
 * @author SNIPPIK
 * @description Параметры событий по указанию type
 * @type ListenerSignature
 */
type ListenerSignature<L> = {
    [E in keyof L]: (...args: any[]) => any;
};

/**
 * @author SNIPPIK
 * @description Параметры событий по умолчанию
 * @type DefaultListener
 */
type DefaultListener = {
    [k: string]: (...args: any[]) => any;
};

/**
 * @author SNIPPIK
 * @description Класс для создания типизированного EventEmitter
 * @class TypedEmitter
 * @abstract
 */
export abstract class TypedEmitter<L extends ListenerSignature<L> = DefaultListener> extends EventEmitterAsyncResource {
    static defaultMaxListeners: number;
    //@ts-ignore
    addListener<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    prependListener<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    prependOnceListener<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    removeListener<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    removeAllListeners(event?: keyof L): this;
    //@ts-ignore
    once<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    on<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    off<U extends keyof L>(event: U, listener: L[U]): this;
    //@ts-ignore
    emit<U extends keyof L>(event: U, ...args: Parameters<L[U]>): boolean;
    //@ts-ignore
    eventNames<U extends keyof L>(): U[];
    //@ts-ignore
    listenerCount(type: keyof L): number;
    //@ts-ignore
    listeners<U extends keyof L>(type: U): L[U][];
    //@ts-ignore
    rawListeners<U extends keyof L>(type: U): L[U][];

    public constructor() {
        super();

        // Задаем максимально кол-во события к одному имени
        this.setMaxListeners(5);
    };
}