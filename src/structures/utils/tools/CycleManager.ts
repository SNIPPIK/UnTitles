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
    /** Последняя фактическая длительность шага (в мс), используется для расчёта джиттера. */
    private lastDuration = 0;

    /** Текущее значение джиттера (отклонение фактического интервала от ожидаемого). */
    private _jitter = 0;
    /** Время, затраченное на выполнение последнего шага `_stepCycle`. */
    private _executionTime = 0;

    /** Максимальный зафиксированный джиттер за время работы (сбрасывается каждые 50 тиков). */
    private _maxJitter = 0;
    /** Максимальное время выполнения шага за время работы (сбрасывается каждые 50 тиков). */
    private _maxExecutionTime = 0;

    /**
     * Реальная разница между фактическими моментами запуска соседних шагов.
     */
    //@ts-ignore
    private _realDelta = 0;

    /** Временная метка последнего шага (в миллисекундах от старта). */
    private _lastStep = 0;

    /** Общее количество выполненных шагов (сбрасывается каждые 50 тиков). */
    private _ticks = 0;

    /** Ожидаемое время следующего срабатывания (в миллисекундах от старта). */
    private nextExecutionTime = 0;

    /** Таймер (setTimeout или setImmediate), планирующий следующий шаг. */
    private timer: NodeJS.Timeout | NodeJS.Immediate | null = null;

    /**
     * Возвращает строку с дополнительными диагностическими данными.
     * По умолчанию возвращает пустую строку; переопределяется в наследниках.
     *
     * @protected
     */
    protected diagnostic(): string {
        return "";
    };

    /**
     * Монотонное время в миллисекундах (performance.now()).
     * Используется для всех временных расчётов.
     *
     * @protected
     */
    protected get time(): number {
        return performance.now();
    };

    /**
     * Предполагаемое время следующего запуска (в миллисекундах от старта).
     * Устанавливается при планировании шага.
     */
    public get insideTime(): number {
        return this.nextExecutionTime;
    };

    /**
     * Текущий интервал между шагами (мс), обычно равен `options.duration`.
     */
    public get delay(): number {
        return this.lastDuration;
    };

    /**
     * Средний джиттер Event Loop (отклонение фактического запуска от плана).
     * Рассчитывается по формуле экспоненциального скользящего среднего.
     */
    public get drift(): number {
        return this._jitter;
    };

    /**
     * Среднее время выполнения одного прохода `_stepCycle` (мс).
     * Также сглаживается экспоненциально.
     */
    public get executionTime(): number {
        return this._executionTime;
    };

    /**
     * @description Конструктор.
     * @param options - конфигурация цикла (содержит `duration` и необязательный `custom`).
     * @throws {Error} если duration <= 0.
     */
    public constructor(
        public options: SyncCycleConfig<T> | AsyncCycleConfig<T>
    ) {
        super();

        // Проверяем, что интервал положительный.
        if (options.duration <= 0) {
            throw Error("Duration must be a positive number");
        }

        // Инициализируем lastDuration значением из конфигурации.
        this.lastDuration = options.duration;
    };

    /**
     * Добавляет элемент в очередь и запускает цикл при необходимости.
     *
     * Если элемент уже существует, он удаляется и добавляется заново
     * (для сброса возможного состояния). При добавлении первого элемента
     * цикл запускается немедленно через `setImmediate`.
     *
     * @param item - элемент для добавления.
     * @returns this (для цепочечных вызовов).
     */
    public add(item: T): this {
        // Вызываем внешний хук добавления (если задан).
        this.options.custom?.push?.(item);

        // Если элемент уже есть, удаляем его, чтобы обновить состояние.
        if (this.has(item)) this.delete(item);

        // Добавляем в базовую коллекцию.
        super.add(item);

        // Если это первый элемент и цикл ещё не запущен (nextExecutionTime == 0),
        // инициализируем время следующего запуска и планируем первый шаг.
        if (this.size === 1 && !this.nextExecutionTime) {
            const now = this.time;
            this.nextExecutionTime = now + this.options.duration;
            // Используем setImmediate для немедленного запуска без задержки.
            this.timer = setImmediate(this.step);
        }

        return this;
    };

    /**
     * Удаляет элемент из очереди.
     *
     * @param item - элемент для удаления.
     * @returns true если элемент был удалён, иначе false.
     */
    public delete(item: T): boolean {
        // Если элемента нет, ничего не делаем.
        if (!this.has(item)) return false;

        // Вызываем внешний хук удаления (если задан).
        this.options.custom?.remove?.(item);

        return super.delete(item);
    };

    /**
     * Полная очистка очереди и остановка цикла.
     * Сбрасывает все временные показатели и статистику.
     */
    public reset(): void {
        // Удаляем текущий таймер (если есть).
        this.clearTimer();
        // Очищаем коллекцию.
        this.clear();

        // Сбрасываем время следующего запуска.
        this.nextExecutionTime = 0;
        // Сбрасываем интервал.
        this.lastDuration = 0;

        // Обнуляем статистику.
        this._jitter = 0;
        this._executionTime = 0;
        this._realDelta = 0;
        this._lastStep = 0;
    };

    /**
     * Очищает активный таймер, если он существует.
     * Определяет тип таймера по наличию метода `hasRef`.
     *
     * @protected
     */
    protected clearTimer(): void {
        // Если таймера нет, выходим.
        if (!this.timer) return;

        // Проверяем, является ли таймер Timeout (у него есть метод hasRef).
        if ("hasRef" in this.timer) {
            clearTimeout(this.timer as NodeJS.Timeout);
        } else {
            // Иначе это Immediate.
            clearImmediate(this.timer as NodeJS.Immediate);
        }

        this.timer = null;
    };

    /**
     * Планирует следующий шаг цикла с учётом текущего времени.
     * Если коллекция пуста, вызывает reset и прекращает цикл.
     *
     * @protected
     */
    protected scheduleStep(): void {
        // Если нет элементов, останавливаем цикл.
        if (this.size === 0) return this.reset();

        const now = this.time;

        // Вычисляем задержку до запланированного момента.
        const delay = this.nextExecutionTime - now;

        // Очищаем старый таймер перед установкой нового.
        this.clearTimer();

        // Если уже пора выполнять (задержка <= 0), используем setImmediate,
        // иначе setTimeout с рассчитанной задержкой.
        if (delay <= 1) {
            this.timer = setImmediate(this.step);
        } else {
            this.timer = setTimeout(this.step, delay);
        }
    };

    /**
     * Основной шаг цикла: выполняет `_stepCycle`, обновляет статистику
     * и планирует следующий запуск.
     *
     * @private
     */
    private step = (): void => {
        // Обнуляем ссылку на таймер (он уже сработал).
        this.timer = null;

        // Если коллекция пуста, сбрасываем и выходим.
        if (this.size === 0) return this.reset();

        // Запоминаем запланированное время.
        const scheduled = this.nextExecutionTime;
        // Фактическое время начала шага.
        const start = this.time;

        // Вычисляем реальный интервал между двумя последовательными запусками.
        if (this._lastStep !== 0) {
            this._realDelta = start - this._lastStep;
        }
        this._lastStep = start;

        // Джиттер = насколько позже фактического момента мы запустились.
        const jitter = Math.max(0, start - scheduled);
        // Экспоненциальное скользящее среднее (EMA) с коэффициентом 0.1.
        this._jitter = this._jitter * 0.9 + jitter * 0.1;

        // Обновляем максимум.
        if (jitter > this._maxJitter) this._maxJitter = jitter;

        // Выполняем полезную работу шага.
        try {
            this._stepCycle();
        } catch (error) {
            // Логируем ошибку, не прерывая цикл.
            console.error(error);
        }

        // Время окончания шага.
        const end = this.time;
        // Время выполнения `_stepCycle`.
        const exec = end - start;

        // EMA времени выполнения.
        this._executionTime = this._executionTime * 0.9 + exec * 0.1;
        // Обновляем максимум.
        if (exec > this._maxExecutionTime) this._maxExecutionTime = exec;

        // Вычисляем следующее запланированное время.
        this.nextExecutionTime = scheduled + this.options.duration;
        // Если мы уже опаздываем (например, шаг выполнялся слишком долго),
        // пересинхронизируемся: следующий запуск будет не раньше, чем через duration от текущего конца.
        if (this.nextExecutionTime <= end) {
            this.nextExecutionTime = end + this.options.duration;
        }

        // Сохраняем фактический интервал (равен запланированному).
        this.lastDuration = this.options.duration;

        // Каждые 50 тиков сбрасываем максимумы, чтобы они отражали недавнюю статистику.
        if (++this._ticks > 50) {
            this._ticks = 0;
            this._maxExecutionTime = 0;
            this._maxJitter = 0;
        }

        // Планируем следующий шаг.
        this.scheduleStep();
    };

    /**
     * Абстрактный метод, реализующий полезную нагрузку одного шага.
     * Должен быть определён в классе-наследнике.
     *
     * @protected
     * @abstract
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