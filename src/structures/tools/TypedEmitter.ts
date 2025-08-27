/**
 * @author SNIPPIK
 * @description Параметры событий по указанию type
 * @type ListenerSignature
 * @public
 */
export type ListenerSignature<L> = {
    [E in keyof L]: L[E] extends (...args: any[]) => any ? L[E] : (...args: any[]) => void;
};

/**
 * @author SNIPPIK
 * @description Параметры событий по умолчанию
 * @type DefaultListener
 * @public
 */
export type DefaultListener = (...args: any[]) => void | Promise<void>;

/**
 * @author SNIPPIK
 * @description Тип события для разделения on и once
 * @interface EventBucket
 * @private
 */
interface EventBucket {
    listener: DefaultListener;
    type: "on" | "once"
}

/**
 * @author SNIPPIK
 * @description Типизированный EventEmitter построенный на Map
 * @template L - Интерфейс событий и их типов слушателей
 * @class TypedEmitter
 * @public
 *
 * @usage Если требуется ответ в событиях once использовать async!
 */
export class TypedEmitter<L extends Record<string, any>> {
    /**
     * @description Локальной список событий, функций в map
     * @private
     */
    private _set = new Map<string, EventBucket[]>();

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
        const arr = this._set.get(event) ?? [];
        arr.push({ listener, type: "on" });
        this._set.set(event, arr);
        return this;
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
        const arr = this._set.get(event) ?? [];
        arr.push({ listener, type: "once" });
        this._set.set(event, arr);
        return this;
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
        const arr = this._set?.get(event);
        if (!arr?.length) return false;

        for (const run of arr) {
            const res = run.listener(...args);

            // 🚀 Асинхронный emit
            if (res instanceof Promise) {
                res.catch(err => {
                    // Чтобы ошибки не "падали" в unhandledRejection
                    setImmediate(() => { throw err; });
                }).finally(() => {
                    // Если разовая функция
                    if (run.type === "once") this.off(event, run.listener as any);
                });
            } else {
                // Если разовая функция
                if (run.type === "once") this.off(event, run.listener as any);
            }
        }
        return true;
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
        const arr = this._set?.get(event);
        if (!arr) return this;
        this._set.set(event, arr.filter(x => x.listener !== listener));
        return this;
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
        this._set.delete(event);

        // Если есть событие с таким именем
        if (listener) listener();
        return this;
    };

    /**
     * @description Все слушатели по названию события
     * @param event - Название события
     * @public
     */
    public listeners<E extends keyof ListenerSignature<E>>(event: string) {
        return (this._set.get(event) ?? []).map(l => l.listener);
    };

    /**
     * @description Удаление всех событий
     * @public
     */
    public removeAllListeners = () => {
        this._set.clear();
        return this;
    };

    /**
     * @description Удаление всех событий и уничтожение TypedEmitter
     * @public
     */
    public destroy(): void {
        this.removeAllListeners();
        this._set = null;
    };
}