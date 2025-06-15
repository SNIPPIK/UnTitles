import { EventEmitterAsyncResource } from "node:events";

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
 * @description Типизированный EventEmitter с поддержкой async ресурсов и ограничением количества слушателей
 * @template L - Интерфейс событий и их типов слушателей
 * @class TypedEmitter
 * @extends EventEmitterAsyncResource
 * @public
 */
export class TypedEmitter<L extends Record<string, any>> extends EventEmitterAsyncResource {
    /**
     * @description Инициализирует новый экземпляр TypedEmitter с максимальным количеством слушателей 5
     * @public
     */
    public constructor() {
        super();
        this.setMaxListeners(5);
    };

    /**
     * @description Подписаться на событие с типизированным слушателем
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public on<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public on<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public on(event: string, listener: (...args: any[]) => any): this {
        return super.on(event, listener);
    };

    /**
     * @description Подписаться на событие один раз с типизированным слушателем
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public once<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public once<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public once(event: string, listener: (...args: any[]) => any): this {
        return super.once(event, listener);
    };

    /**
     * @description Вызывает событие с передачей аргументов в слушателей
     * @param event - Имя события
     * @param args - Аргументы для слушателей
     * @returns true если событие было обработано хотя бы одним слушателем, иначе false
     * @public
     */
    public emit<E extends keyof ListenerSignature<L>>(event: E, ...args: Parameters<ListenerSignature<L>[E]>): boolean;
    public emit<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, ...args: any[]): boolean;
    public emit(event: string, ...args: any[]): boolean {
        return super.emit(event, ...args);
    };

    /**
     * @description Отписаться от события
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public off<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public off<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public off(event: string, listener: (...args: any[]) => any): this {
        return super.off(event, listener);
    };

    /**
     * @description Псевдоним для off — удалить слушатель события
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public removeListener<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public removeListener<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public removeListener(event: string, listener: (...args: any[]) => any): this {
        return super.removeListener(event, listener);
    };
}