import { TypedEmitter as EventEmitter } from "tiny-typed-emitter";

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
 * @description Класс для создания eventEmitter
 * @class TypedEmitter
 * @abstract
 */
export abstract class TypedEmitter<L extends ListenerSignature<L> = DefaultListener> extends EventEmitter<L> {
    public constructor() {
        super();

        // Задаем максимально кол-во события к одному имени
        this.setMaxListeners(5);
    };
}