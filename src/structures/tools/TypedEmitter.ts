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
    /**
     * @description Сам слушатель
     * @readonly
     * @public
     */
    readonly listener: DefaultListener;

    /**
     * @description Тип функции вызова
     * @readonly
     * @public
     */
    readonly type: "on" | "once";

    _removed?: boolean;
}

/**
 * @author SNIPPIK
 * @description Типизированный EventEmitter построенный на Object-Map системе, работает чуть быстрее чем vanilla EventEmitter
 * @template L - Интерфейс событий и их типов слушателей
 * @class TypedEmitter
 * @public
 *
 * @usage Если требуется ответ в событиях once использовать async!
 */
export class TypedEmitter<L extends Record<string, any>> {
    /** Локальной список событий, функций в map */
    private _events = new Map<string, EventBucket[]>();

    /** Максимальное количество слушателей на одно событие */
    private _maxListeners = 10;

    /** Флаг для однократного предупреждения о превышении лимита */
    private _warned = false;

    /**
     * @description Оптимизированное удаление элемента из массива по индексу (как в Node.js)
     * @param list - Массив
     * @param index - Индекс удаляемого элемента
     * @private
     * @static
     */
    private static spliceOne<T>(list: T[], index: number): void {
        for (let i = index + 1; i < list.length; i++) {
            list[i - 1] = list[i];
        }

        list.pop();
    }

    /**
     * @description Внутренний метод добавления слушателя с учётом maxListeners и newListener
     * @param event - Имя события
     * @param bucket - Объект слушателя
     * @param prepend - Добавить в начало массива?
     * @private
     */
    private _addListener = (event: string, bucket: EventBucket, prepend: boolean): void => {
        // Выполняем newListener до добавления (как в оригинальном EventEmitter)
        this.emit('newListener' as any, event, bucket.listener);

        let arr = this._events.get(event);
        if (!arr) {
            arr = [];
            this._events.set(event, arr);
        }

        if (prepend) arr.unshift(bucket);
        else arr.push(bucket);

        if (this._maxListeners > 0 && arr.length > this._maxListeners && !this._warned) {
            this._warned = true;
            console.warn(
                `Possible TypedEmitter memory leak detected. ${arr.length} ${event} listeners added.`
            );
        }
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
        this._addListener(event, { listener, type: "on" }, false);
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
        this._addListener(event, { listener, type: "once" }, false);
        return this;
    };

    /**
     * @description Добавить слушатель в начало очереди (выполнится перед обычными)
     * @param event - Имя события
     * @param listener - Функция-обработчик
     * @returns this
     * @public
     */
    public prependListener<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public prependListener<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public prependListener(event: string, listener: (...args: any[]) => any): this {
        this._addListener(event, { listener, type: "on" }, true);
        return this;
    };

    /**
     * @description Добавить одноразовый слушатель в начало очереди
     * @param event - Имя события
     * @param listener - Функция-обработчик
     * @returns this
     * @public
     */
    public prependOnceListener<E extends keyof ListenerSignature<L>>(event: E, listener: ListenerSignature<L>[E]): this;
    public prependOnceListener<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener: DefaultListener): this;
    public prependOnceListener(event: string, listener: (...args: any[]) => any): this {
        this._addListener(event, { listener, type: "once" }, true);
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
        if (event === "error") {
            const err = args[0] instanceof Error ? args[0] : new Error(String(args[0]));
            if (this.listenerCount("error") === 0) throw err;
        }

        const arr = this._events.get(event);
        if (!arr || arr.length === 0) return false;

        let hasOnce = false;

        for (let i = 0; i < arr.length; i++) {
            const bucket = arr[i];

            const result = bucket.listener(...args);

            if (bucket.type === "once") {
                bucket._removed = true;
                hasOnce = true;
            }

            if (result && typeof (result as any).then === "function") {
                (result as Promise<any>).catch(err => {
                    if (this.listenerCount("error") > 0) {
                        //@ts-ignore
                        this.emit("error", err);
                    } else {
                        process.nextTick(() => { throw err; });
                    }
                });
            }
        }

        // cleanup once listeners (O(n), без findIndex)
        if (hasOnce) {
            let write = 0;

            for (let read = 0; read < arr.length; read++) {
                if (!arr[read]._removed) {
                    arr[write++] = arr[read];
                }
            }

            arr.length = write;

            if (arr.length === 0) {
                this._events.delete(event);
            }
        }

        return true;
    }

    /**
     * @description Отписаться от события
     * @param event - Имя события
     * @param listener - Функция-обработчик события (если не указан - удалить всех)
     * @returns this
     * @public
     */
    public off<E extends keyof ListenerSignature<L>>(event: E, listener?: ListenerSignature<L>[E]): this;
    public off<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener?: DefaultListener): this;
    public off(event: string, listener?: DefaultListener): this {
        const arr = this._events.get(event);
        if (!arr) return this;

        if (!listener) {
            this._events.delete(event);
            return this;
        }

        for (let i = 0; i < arr.length; i++) {
            if (arr[i].listener === listener) {
                TypedEmitter.spliceOne(arr, i);
                break;
            }
        }

        if (arr.length === 0) this._events.delete(event);
        return this;
    };

    /**
     * @description Псевдоним для off — удалить слушатель события
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public removeListener = this.off;

    /**
     * @description Все слушатели по названию события (только функции, без обёрток)
     * @param event - Название события
     * @returns Массив функций-слушателей
     * @public
     */
    public listeners<E extends keyof L>(event: E): DefaultListener[];
    public listeners(event: string): DefaultListener[] {
        const arr = this._events.get(event);
        if (!arr) return [];

        const out = new Array(arr.length);
        for (let i = 0; i < arr.length; i++) {
            out[i] = arr[i].listener;
        }
        return out;
    };

    /**
     * @description Количество слушателей на событие
     * @param event - Название события
     * @returns Число слушателей
     * @public
     */
    public listenerCount = (event: string): number => {
        return this._events.get(event)?.length ?? 0;
    };

    /**
     * @description Установить максимальное количество слушателей (0 - неограниченно)
     * @param n - Новый лимит
     * @returns this
     * @throws RangeError если n не число или отрицательное/NaN
     * @public
     */
    public setMaxListeners = (n: number): this => {
        // Если указывается не число а что-то другое
        if (typeof n !== 'number' || n < 0 || Number.isNaN(n)) {
            throw new RangeError(`Expected non-negative number, got ${n}`);
        }

        this._maxListeners = n;
        this._warned = false;
        return this;
    };

    /**
     * @description Получить текущий максимальный лимит слушателей
     * @returns number
     * @public
     */
    public getMaxListeners = (): number => {
        return this._maxListeners;
    };

    /**
     * @description Удаление всех событий или конкретного события
     * @param event - (опционально) имя события
     * @returns this
     * @public
     */
    public removeAllListeners = (event?: string): this => {
        // Если есть имя события
        if (event) this._events.delete(event);
        else this._events.clear();
        return this;
    };

    /**
     * @description Удаление всех событий и уничтожение TypedEmitter
     * @public
     */
    public destroy(): void {
        this._events.clear();
        this._warned = false;
        this._maxListeners = 10;
    };
}