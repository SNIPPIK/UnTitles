import { SetArray } from "../array/index.set.js";

/**
 * Базовый класс цикла с точным управлением временем.
 *
 * Управляет периодическим выполнением абстрактного шага `_stepCycle` через
 * заданный интервал `options.duration`. Ведёт статистику по джиттеру
 * (отклонению фактического запуска от запланированного) и времени выполнения
 * шага, используя экспоненциальное скользящее среднее для сглаживания.
 *
 * Наследует `SetArray<T>`, поэтому также является коллекцией элементов.
 * Цикл автоматически запускается при добавлении первого элемента и
 * останавливается, когда коллекция становится пустой.
 *
 * @typeParam T - тип элементов коллекции (по умолчанию `unknown`).
 * @abstract
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    /** Фактический интервал между последними двумя запусками цикла. */
    private _realDelta = 0;

    /** EMA абсолютного отклонения фактического интервала от заданного duration. */
    private _intervalJitter = 0;

    /** EMA абсолютного отклонения фактического старта от запланированного deadline. */
    private _jitter = 0;

    /** EMA времени выполнения последнего шага. */
    private _executionTime = 0;

    /** Максимальное отклонение старта от deadline за текущую выборку. */
    private _maxJitter = 0;

    /** Максимальное отклонение фактического интервала за текущую выборку. */
    private _maxIntervalJitter = 0;

    /** Максимальное время выполнения шага за текущую выборку. */
    private _maxExecutionTime = 0;

    /** Количество тиков в текущей статистической выборке. */
    private _ticks = 0;

    /** Количество пропущенных интервалов в текущей выборке. */
    private _skippedTicks = 0;

    /** Общее количество пропущенных интервалов за время жизни системы. */
    private _totalSkippedTicks = 0;

    /** Время фактического запуска предыдущего шага. */
    private _lastStep = 0;

    /** Запланированное время следующего запуска. */
    private nextExecutionTime = 0;

    /** Активный Node.js timer. */
    private timer: NodeJS.Timeout | NodeJS.Immediate | null = null;

    /** Коэффициент EMA. */
    private static readonly EMA_ALPHA = 0.1;

    /** Количество тиков в статистической выборке. */
    private static readonly STAT_TICKS = 50;

    /**
     * Дополнительная диагностическая информация.
     *
     * Формат:
     * cycle{...} timing{...} execution{...}
     *
     * Может быть переопределён в наследниках для добавления
     * специфичных диагностических данных.
     *
     * @protected
     */
    protected diagnostic(): string {
        const timing = [
            `delta=${this._realDelta.toFixed(3)}ms`,
            `drift=${this._jitter.toFixed(3)}ms`,
            `max=${this._maxJitter.toFixed(3)}ms`,
            `interval=${this._intervalJitter.toFixed(3)}ms`,
            `maxInterval=${this._maxIntervalJitter.toFixed(3)}ms`,
        ].join(", ");

        const execution = [
            `avg=${this._executionTime.toFixed(3)}ms`,
            `max=${this._maxExecutionTime.toFixed(3)}ms`,
        ].join(", ");

        const cycle = [
            `size=${this.size}`,
            `ticks=${this._ticks}`,
            `skipped=${this._skippedTicks}`,
            `totalSkipped=${this._totalSkippedTicks}`,
            `period=${this.options.duration.toFixed(3)}ms`,
            `next=${this.nextExecutionTime.toFixed(3)}ms`,
        ].join(", ");

        return [
            `cycle{${cycle}}`,
            `timing{${timing}}`,
            `execution{${execution}}`,
        ].join(" | ");
    };

    /**
     * Монотонное время в миллисекундах.
     */
    protected get time(): number {
        return performance.now();
    }

    /**
     * Запланированное время следующего запуска.
     */
    public get insideTime(): number {
        return this.nextExecutionTime;
    }

    /**
     * Настроенный период цикла.
     */
    public get delay(): number {
        return this.options.duration;
    }

    /**
     * EMA отклонения фактического запуска от deadline.
     *
     * Положительное значение — запуск позже deadline.
     * Отрицательное значение — запуск раньше deadline.
     */
    public get drift(): number {
        return this._jitter;
    }

    /**
     * Последний фактический интервал между запусками.
     */
    public get realDelta(): number {
        return this._realDelta;
    }

    /**
     * EMA абсолютного отклонения фактического интервала от duration.
     */
    public get intervalJitter(): number {
        return this._intervalJitter;
    }

    /**
     * EMA времени выполнения одного шага.
     */
    public get executionTime(): number {
        return this._executionTime;
    }

    /**
     * Максимальное отклонение запуска от deadline
     * в текущей статистической выборке.
     */
    public get maxJitter(): number {
        return this._maxJitter;
    }

    /**
     * Максимальное отклонение фактического интервала
     * от duration в текущей статистической выборке.
     */
    public get maxIntervalJitter(): number {
        return this._maxIntervalJitter;
    }

    /**
     * Максимальное время выполнения шага
     * в текущей статистической выборке.
     */
    public get maxExecutionTime(): number {
        return this._maxExecutionTime;
    }

    /**
     * Количество пропущенных интервалов
     * в текущей статистической выборке.
     */
    public get skippedTicks(): number {
        return this._skippedTicks;
    }

    /**
     * Общее количество пропущенных интервалов.
     */
    public get totalSkippedTicks(): number {
        return this._totalSkippedTicks;
    }

    /**
     * Количество тиков текущей статистической выборки.
     */
    public get ticks(): number {
        return this._ticks;
    }

    /**
     * Показывает, запущен ли цикл.
     */
    public get running(): boolean {
        return this.timer !== null;
    }

    public constructor(
        public options: SyncCycleConfig<T> | AsyncCycleConfig<T>
    ) {
        super();

        if (options.duration <= 0) {
            throw new Error("Duration must be a positive number");
        }
    }

    /**
     * Добавляет элемент в цикл.
     */
    public add(item: T): this {
        this.options.custom?.push?.(item);

        if (this.has(item)) {
            this.delete(item);
        }

        super.add(item);

        if (this.size === 1 && this.nextExecutionTime === 0) {
            const now = this.time;

            this.nextExecutionTime = now + this.options.duration;

            this.timer = setTimeout(
                this.step,
                this.options.duration
            );
        }

        return this;
    }

    /**
     * Удаляет элемент из цикла.
     */
    public delete(item: T): boolean {
        if (!this.has(item)) {
            return false;
        }

        this.options.custom?.remove?.(item);

        return super.delete(item);
    }

    /**
     * Полностью останавливает цикл и сбрасывает текущую статистику.
     *
     * Lifetime-счётчик пропущенных тиков сохраняется.
     */
    public reset(): void {
        this.clearTimer();
        this.clear();

        this.nextExecutionTime = 0;

        this._realDelta = 0;
        this._intervalJitter = 0;
        this._jitter = 0;
        this._executionTime = 0;

        this._maxJitter = 0;
        this._maxIntervalJitter = 0;
        this._maxExecutionTime = 0;

        this._ticks = 0;
        this._skippedTicks = 0;

        this._lastStep = 0;
    }

    /**
     * Очищает активный timer.
     */
    protected clearTimer(): void {
        if (this.timer === null) {
            return;
        }

        if ("hasRef" in this.timer) {
            clearTimeout(this.timer as NodeJS.Timeout);
        } else {
            clearImmediate(this.timer as NodeJS.Immediate);
        }

        this.timer = null;
    }

    /**
     * Планирует следующий запуск цикла.
     *
     * Deadline рассчитывается относительно предыдущего deadline,
     * а не относительно текущего времени. Это сохраняет стабильную
     * временную сетку цикла.
     */
    protected scheduleStep(): void {
        if (this.size === 0) {
            this.reset();
            return;
        }

        const now = this.time;
        const delay = this.nextExecutionTime - now;

        this.clearTimer();

        if (delay <= 0) {
            this.timer = setImmediate(this.step);
            return;
        }

        this.timer = setTimeout(this.step, delay);
    }

    /**
     * Основной шаг цикла.
     */
    private step = (): void => {
        this.timer = null;

        if (this.size === 0) {
            this.reset();
            return;
        }

        const scheduled = this.nextExecutionTime;
        const start = this.time;

        /*
         * -------------------------------------------------------------
         * Timing diagnostics
         * -------------------------------------------------------------
         */

        // Ошибка запуска относительно deadline.
        const jitter = start - scheduled;

        this._jitter =
            this._jitter * (1 - DefaultCycleSystem.EMA_ALPHA) +
            jitter * DefaultCycleSystem.EMA_ALPHA;

        const absJitter = Math.abs(jitter);

        if (absJitter > this._maxJitter) {
            this._maxJitter = absJitter;
        }

        /*
         * Фактический интервал между двумя последовательными
         * запусками цикла.
         */
        if (this._lastStep !== 0) {
            this._realDelta = start - this._lastStep;

            const intervalJitter =
                this._realDelta - this.options.duration;

            const absIntervalJitter =
                Math.abs(intervalJitter);

            this._intervalJitter =
                this._intervalJitter *
                (1 - DefaultCycleSystem.EMA_ALPHA) +
                absIntervalJitter *
                DefaultCycleSystem.EMA_ALPHA;

            if (absIntervalJitter > this._maxIntervalJitter) {
                this._maxIntervalJitter = absIntervalJitter;
            }
        }

        this._lastStep = start;

        /*
         * -------------------------------------------------------------
         * Missed ticks
         * -------------------------------------------------------------
         */

        if (jitter >= this.options.duration) {
            const skipped = Math.floor(
                jitter / this.options.duration
            );

            this._skippedTicks += skipped;
            this._totalSkippedTicks += skipped;
        }

        /*
         * -------------------------------------------------------------
         * Cycle work
         * -------------------------------------------------------------
         */

        try {
            this._stepCycle();
        } catch (error) {
            console.error(error);
        }

        /*
         * -------------------------------------------------------------
         * Execution diagnostics
         * -------------------------------------------------------------
         */

        const end = this.time;
        const executionTime = end - start;

        this._executionTime =
            this._executionTime *
            (1 - DefaultCycleSystem.EMA_ALPHA) +
            executionTime *
            DefaultCycleSystem.EMA_ALPHA;

        if (executionTime > this._maxExecutionTime) {
            this._maxExecutionTime = executionTime;
        }

        /*
         * -------------------------------------------------------------
         * Next deadline
         * -------------------------------------------------------------
         *
         * ВАЖНО:
         *
         * Следующий deadline считается от ПРЕДЫДУЩЕГО deadline.
         * Мы не делаем:
         *
         *     end + duration
         *
         * потому что это меняет фазу периодического цикла.
         */

        this.nextExecutionTime =
            scheduled + this.options.duration;

        /*
         * Если выполнение шага заняло слишком много времени
         * и следующий deadline уже прошёл, пропускаем просроченные
         * интервалы, сохраняя исходную временную сетку.
         */
        if (this.nextExecutionTime <= end) {
            const late = end - this.nextExecutionTime;

            const skipped =
                Math.floor(
                    late / this.options.duration
                ) + 1;

            this.nextExecutionTime +=
                skipped * this.options.duration;

            this._skippedTicks += skipped;
            this._totalSkippedTicks += skipped;
        }

        /*
         * -------------------------------------------------------------
         * Statistics window
         * -------------------------------------------------------------
         */

        this._ticks++;

        if (this._ticks >= DefaultCycleSystem.STAT_TICKS) {
            this._ticks = 0;
            this._maxJitter = 0;
            this._maxIntervalJitter = 0;
            this._maxExecutionTime = 0;
            this._skippedTicks = 0;
        }

        /*
         * -------------------------------------------------------------
         * Next iteration
         * -------------------------------------------------------------
         */

        this.scheduleStep();
    };

    /**
     * Полезная нагрузка одного шага.
     */
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
                    result.catch((err) => {
                        console.error("[TaskCycle] Async execution error:", err);
                        this.delete(item);
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