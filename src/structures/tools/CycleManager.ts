import { SetArray } from "#structures/array/index.js";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла с точным управлением временем
 * @class DefaultCycleSystem
 * @extends SetArray
 * @abstract
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    private lastDuration = 0;

    /**
     * Среднее отклонение запуска от ожидаемого времени.
     */
    private _jitter = 0;

    /**
     * Среднее время выполнения цикла.
     */
    private _executionTime = 0;

    /**
     * Предполагаемое время следующего запуска.
     */
    private nextExecutionTime = 0;

    /**
     * Таймер Node.js.
     */
    private timer: NodeJS.Timeout | NodeJS.Immediate | null = null;

    /**
     * Монотонное время в миллисекундах.
     */
    protected get time(): number {
        return performance.now();
    };

    /**
     * Предполагаемое время следующего запуска.
     */
    public get insideTime(): number {
        return this.nextExecutionTime;
    };

    /**
     * Текущий интервал.
     */
    public get delay(): number {
        return this.lastDuration;
    };

    /**
     * Средний jitter Event Loop.
     */
    public get drift(): number {
        return this._jitter;
    };

    /**
     * Среднее время выполнения одного прохода.
     */
    public get executionTime(): number {
        return this._executionTime;
    };

    /**
     * @description Конструктор
     * @param options - конфигурация цикла
     * @throws {Error} если duration <= 0
     */
    public constructor(
        public options: SyncCycleConfig<T> | AsyncCycleConfig<T>
    ) {
        super();

        if (options.duration <= 0) {
            throw Error("Duration must be a positive number");
        }

        this.lastDuration = options.duration;
    };

    /**
     * @description Добавляет элемент в очередь и запускает цикл при необходимости
     * @param item - элемент для добавления
     * @returns this
     */
    public add(item: T): this {
        this.options.custom?.push?.(item);

        if (this.has(item)) {
            this.delete(item);
        }

        super.add(item);

        if (this.size === 1 && !this.nextExecutionTime) {
            const now = this.time;

            this.nextExecutionTime =
                now + this.options.duration;

            this.timer = setImmediate(this.step);
        }

        return this;
    };

    /**
     * @description Удаляет элемент из очереди
     * @param item - элемент для удаления
     * @returns true если элемент был удалён, иначе false
     */
    public delete(item: T): boolean {
        if (!this.has(item)) return false;
        this.options.custom?.remove?.(item);

        return super.delete(item);
    };

    /**
     * @description Полная очистка очереди и остановка цикла
     */
    public reset(): void {
        this.clearTimer();
        this.clear();

        this.nextExecutionTime = 0;

        this.lastDuration = 0;

        this._jitter = 0;
        this._executionTime = 0;
    };

    /**
     * @description Очищает активный таймер, если он существует
     * @protected
     */
    protected clearTimer(): void {
        if (!this.timer) {
            return;
        }

        if ("hasRef" in this.timer) {
            clearTimeout(this.timer as NodeJS.Timeout);
        } else {
            clearImmediate(this.timer as NodeJS.Immediate);
        }

        this.timer = null;
    };

    /**
     * @description Планирует следующий шаг цикла с учётом времени выполнения
     * @protected
     */
    protected scheduleStep(): void {
        if (this.size === 0) {
            this.reset();
            return;
        }

        const now = this.time;

        /**
         * Здесь НЕ пытаемся обеспечить точность.
         *
         * Node.js timer — только приблизительная
         * точка запуска producer-а.
         */
        const delay =
            this.nextExecutionTime - now;

        this.clearTimer();

        if (delay <= 0) {
            this.timer = setImmediate(this.step);
        } else {
            this.timer = setTimeout(
                this.step,
                delay
            );
        }
    };

    /**
     * @description Основной шаг цикла
     * @private
     */
    private step = (): void => {
        this.timer = null;

        if (this.size === 0) {
            this.reset();
            return;
        }

        const scheduled = this.nextExecutionTime;
        const start = this.time;

        /**
         * Реальное отклонение от предполагаемого времени.
         */
        const jitter = Math.max(
            0,
            start - scheduled
        );

        /**
         * Сглаживаем статистику.
         */
        this._jitter =
            this._jitter * 0.9 +
            jitter * 0.1;

        try {
            this._stepCycle();
        } catch (error) {
            console.error(
                "[CycleSystem] Unhandled error:",
                error
            );
        }

        const end = this.time;

        /**
         * Время обработки.
         */
        const executionTime = end - start;

        this._executionTime =
            this._executionTime * 0.9 +
            executionTime * 0.1;

        /**
         * Следующая предполагаемая точка.
         *
         * Это именно prediction,
         * а не жёсткий deadline.
         */
        this.nextExecutionTime =
            scheduled + this.options.duration;

        /**
         * Если Node сильно отстал —
         * не пытаемся догнать старое расписание.
         */
        if (this.nextExecutionTime <= end) {
            this.nextExecutionTime =
                end + this.options.duration;
        }

        this.lastDuration =
            this.options.duration;

        this.scheduleStep();
    };

    protected abstract _stepCycle(): void;
}

/**
 * @author SNIPPIK
 * @description Синхронный/асинхронный цикл с обработкой элементов
 * @class TaskCycle
 * @extends DefaultCycleSystem
 */
export abstract class TaskCycle<T = unknown> extends DefaultCycleSystem<T> {
    /**
     * @description Выполняет все подходящие элементы цикла
     * @protected
     */
    protected async _stepCycle() {
        for (const item of this.array) {
            // Пропускаем элементы, не прошедшие фильтр
            if (!this.options.filter(item)) continue;

            try {
                const result = this.options.execute(item);

                // Если результат – Promise, обрабатываем возможные ошибки асинхронно
                if (result instanceof Promise) {
                    queueMicrotask(() => {
                        result.catch((err) => {
                            console.error("[TaskCycle] Async execution error:", err);
                            this.delete(item);
                        });
                    });
                }
            } catch (error) {
                // Синхронная ошибка – удаляем элемент и логируем
                console.error("[TaskCycle] Sync execution error:", error);
                this.delete(item);
            }
        }

        // Вызов пользовательского хука после шага
        if (this.options.custom?.step) {
            this.options.custom.step();
        }
    };
}

/**
 * @author SNIPPIK
 * @description Цикл для работы с Promise-ориентированными задачами
 * @class PromiseCycle
 * @extends DefaultCycleSystem
 */
export abstract class PromiseCycle<T = unknown> extends DefaultCycleSystem<T> {
    /**
     * @description Выполняет все подходящие элементы, не дожидаясь Promise
     * @protected
     */
    protected async _stepCycle() {
        for await (const item of this.array) {
            setImmediate(async () => {
                if (await this.options.filter(item)) {
                    Promise.resolve(this.options.execute(item))
                        .then((keep) => {
                            if (keep === false) {
                                this.delete(item);
                            }
                        })
                        .catch((err) => {
                            console.error("[PromiseCycle] Promise execution error:", err);
                            this.delete(item);
                        });
                }
            })
        }

        // Вызов пользовательского хука после шага
        if (this.options.custom?.step) {
            this.options.custom.step();
        }
    };
}

/**
 * @description Базовая конфигурация для всех циклов
 * @interface BaseCycleConfig
 */
interface BaseCycleConfig<T> {
    /** Интервал между шагами (мс) */
    duration: number;

    /** Дополнительные кастомные хуки */
    readonly custom?: {
        /** Вызывается перед добавлением элемента */
        readonly push?: (item: T) => void;

        /** Вызывается перед удалением элемента */
        readonly remove?: (item: T) => void;

        /** Вызывается после завершения шага цикла */
        readonly step?: () => void;
    };
}

/**
 * @description Конфигурация для TaskCycle (синхронные/асинхронные execute)
 * @interface SyncCycleConfig
 */
interface SyncCycleConfig<T> extends BaseCycleConfig<T> {
    /** Фильтр для пропуска элементов, не готовых к обработке */
    readonly filter: (item: T) => boolean;

    /** Функция обработки элемента (может быть синхронной или возвращать Promise) */
    readonly execute: (item: T) => Promise<void> | void;
}

/**
 * @description Конфигурация для PromiseCycle (execute всегда возвращает Promise<boolean>)
 * @interface AsyncCycleConfig
 */
interface AsyncCycleConfig<T> extends BaseCycleConfig<T> {
    /** Фильтр для пропуска элементов, не готовых к обработке */
    readonly filter: (item: T) => Promise<boolean>;

    /** Функция обработки элемента, должна вернуть Promise<boolean> – true, чтобы оставить элемент, false – удалить */
    readonly execute: (item: T) => Promise<boolean>;
}