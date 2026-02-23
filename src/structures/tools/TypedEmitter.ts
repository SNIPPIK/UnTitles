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
    readonly type: "on" | "once"
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
    public once(event: string, listener: (...args: L[]) => any): this {
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
    public emit<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, ...args: L[]): boolean;
    public emit(event: string, ...args: any[]): boolean {
        const arr = this._set?.get(event);
        if (!arr || arr.length === 0) return false;

        /** * Оптимизация: Идем по массиву без создания копии [...arr].
         * Используем цикл в обратном порядке, чтобы удаление once-слушателей
         * через splice не ломало индекс текущей итерации.
         */
        for (let i = arr.length - 1; i >= 0; i--) {
            const run = arr[i];

            // Если это once — удаляем ПЕРЕД вызовом, чтобы избежать рекурсивных петель
            if (run.type === "once") {
                arr.splice(i, 1);
                if (arr.length === 0) this._set.delete(event);
            }

            const res = run.listener(...args);

            if (res instanceof Promise) {
                res.catch(err => {
                    // Если есть слушатели 'error' — шлем им, иначе кидаем в глобал
                    if (this._set.has("error")) {
                        this.emit("error" as any, err);
                    } else {
                        process.nextTick(() => { throw err; });
                    }
                });
            }
        }
        return true;
    }

    /**
     * @description Отписаться от события
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public off<E extends keyof ListenerSignature<L>>(event: E, listener?: ListenerSignature<L>[E]): this;
    public off<S extends string>(event: Exclude<S, keyof ListenerSignature<L>>, listener?: DefaultListener): this;
    public off(event: string, listener?: DefaultListener): this {
        if (!this._set) return this;
        if (!listener) {
            this._set.delete(event);
            return this;
        }

        const arr = this._set.get(event);
        if (!arr) return this;

        for (let i = 0; i < arr.length; i++) {
            if (arr[i].listener === listener) {
                arr.splice(i, 1);
                break; // Удаляем только одно вхождение (как в vanilla EventEmitter)
            }
        }

        if (arr.length === 0) this._set.delete(event);
        return this;
    };

    /**
     * @description Псевдоним для off — удалить слушатель события
     * @param event - Имя события
     * @param listener - Функция-обработчик события
     * @returns this
     * @public
     */
    public removeListener= this.off;

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
        if (this._set) this._set.clear();
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