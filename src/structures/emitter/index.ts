import { EventEmitterAsyncResource } from "node:events";
import { Logger } from "../logger";

/**
 * @author SNIPPIK
 * @description Параметры событий по указанию type
 * @type ListenerSignature
 */
export type ListenerSignature<L> = {
    [E in keyof L]: L[E] extends (...args: any[]) => any ? L[E] : (...args: any[]) => void;
};

/**
 * @author SNIPPIK
 * @description Параметры событий по умолчанию
 * @type DefaultListener
 */
export type DefaultListener = (...args: any[]) => void;

/**
 * @author SNIPPIK
 * @description Класс для создания типизированного EventEmitter
 * @class TypedEmitter
 * @abstract
 */
export class TypedEmitter<L extends Record<string, any>> extends EventEmitterAsyncResource {
    public constructor() {
        super();
        this.setMaxListeners(5);
    };

    // overloads for on
    public on<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public on<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public on(event: string, listener: (...args: any[]) => any): this {
        try {
            return super.on(event, listener);
        } catch (err) {
            Logger.log("ERROR", `[Event/on] [${event}]: ${err}`);
            return this;
        }
    };

    // overloads for once
    public once<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public once<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public once(event: string, listener: (...args: any[]) => any): this {
        try {
            return super.once(event, listener);
        } catch (err) {
            Logger.log("ERROR", `[Event/once] [${event}]: ${err}`);
            return this;
        }
    };

    // overloads for emit
    public emit<E extends keyof ListenerSignature<L>>(event: E, ...args: Parameters<ListenerSignature<L>[E]>): boolean;
    public emit<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, ...args: any[]): boolean;
    public emit(event: string, ...args: any[]): boolean {
        try {
            return super.emit(event, ...args);
        } catch (err) {
            Logger.log("ERROR", `[Event/emit] [${event}]: ${err}`);
            return false;
        }
    };

    // overloads for off (removeListener)
    public off<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public off<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public off(event: string, listener: (...args: any[]) => any): this {
        try {
            return super.off(event, listener);
        } catch (err) {
            Logger.log("ERROR", `[Event/off] [${event}]: ${err}`);
            return this;
        }
    };

    // alias removeListener
    public removeListener<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public removeListener<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public removeListener(event: string, listener: (...args: any[]) => any): this {
        try {
            return super.removeListener(event, listener);
        } catch (err) {
            Logger.log("ERROR", `[Event/removeListener] [${event}]: ${err}`);
            return this;
        }
    };
}