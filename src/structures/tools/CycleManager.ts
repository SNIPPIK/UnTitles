import { SetArray } from "#structures/array/index.js";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла с точным управлением временем
 * @class DefaultCycleSystem
 * @extends SetArray
 * @abstract
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    /**
     * Время (в миллисекундах, относительно `performance.timing.navigationStart` или аналогичного
     * origin), в которое должен выполниться следующий шаг цикла.
     *
     * Изначально `NaN` — признак отсутствия запущенного цикла.
     */
    private nextExecutionTime = NaN;

    /**
     * Идентификатор активного таймера (`setTimeout`), либо `null`, если таймер не установлен.
     */
    private timer: NodeJS.Timeout | null = null;

    /**
     * Флаг, указывающий, запущен ли цикл.
     * Управляет возможностью добавления новых элементов и продолжением шагов.
     */
    private running = false;

    /**
     * Возвращает текущее время в миллисекундах с высокой точностью (`performance.now()`).
     * Используется для вычисления задержек и предотвращения дрейфа времени.
     */
    protected get time(): number {
        return performance.now();
    }

    /**
     * Оставшееся время до следующего запланированного шага (в миллисекундах).
     *
     * - `0`, если цикл не запущен (`nextExecutionTime === NaN`).
     * - Положительное число, если шаг ещё ожидается.
     * - Отрицательное число, если шаг просрочен (теоретически при отставании).
     */
    public get insideTime(): number {
        return Number.isNaN(this.nextExecutionTime)
            ? 0
            : this.nextExecutionTime - this.time;
    }

    /**
     * Создаёт экземпляр циклической системы.
     *
     * @param options - конфигурация цикла.
     * @param options.duration - интервал между шагами в миллисекундах (должен быть > 0).
     * @param options.custom - необязательные хуки для синхронизации с внешней логикой
     * (например, оповещение о добавлении/удалении элементов).
     *
     * @throws {Error} Если `duration <= 0`.
     */
    public constructor(
        public readonly options: SyncCycleConfig<T> | AsyncCycleConfig<T>
    ) {
        super();

        if (options.duration <= 0) {
            throw new Error("Duration must be positive");
        }
    }

    /**
     * Добавляет элемент в коллекцию и автоматически запускает цикл, если он ещё не запущен.
     *
     * Если элемент уже присутствует, он будет сначала удалён, а затем добавлен заново
     * (это гарантирует сброс возможного внутреннего состояния, связанного с элементом).
     *
     * @param item - добавляемый элемент.
     * @returns `this` для цепочечных вызовов.
     */
    public add(item: T): this {
        // Уведомляем внешний хук о добавлении (если задан).
        this.options.custom?.push?.(item);

        // Принудительно удаляем существующий элемент, чтобы обновить его позицию/состояние.
        if (this.has(item)) {
            super.delete(item);
        }

        super.add(item);

        // Если цикл ещё не запущен — стартуем.
        if (!this.running) {
            this.start();
        }

        return this;
    }

    /**
     * Удаляет элемент из коллекции. Если элемент отсутствует, ничего не делает.
     *
     * @param item - удаляемый элемент.
     * @returns `true`, если элемент был удалён, иначе `false`.
     */
    public delete(item: T): boolean {
        if (!this.has(item)) {
            return false;
        }

        // Уведомляем внешний хук об удалении.
        this.options.custom?.remove?.(item);

        return super.delete(item);
    }

    /**
     * Полностью очищает коллекцию, останавливает цикл и сбрасывает внутреннее состояние.
     *
     * Для каждого элемента вызывается внешний хук `remove` (если задан).
     */
    public reset(): void {
        for (const item of this) {
            this.options.custom?.remove?.(item);
        }

        this.clear();
        this.stop();
    }

    /**
     * Запускает цикл, если он ещё не запущен.
     *
     * Устанавливает `running = true`, вычисляет время первого шага
     * и инициирует планирование через `scheduleStep()`.
     */
    protected start(): void {
        if (this.running) {
            return;
        }

        this.running = true;
        this.nextExecutionTime = this.time + this.options.duration;
        this.scheduleStep();
    }

    /**
     * Останавливает цикл: снимает флаг `running`, сбрасывает `nextExecutionTime`
     * в `NaN` и удаляет активный таймер.
     */
    protected stop(): void {
        this.running = false;
        this.nextExecutionTime = NaN;
        this.clearTimer();
    }

    /**
     * Безопасно очищает активный таймер, если он установлен.
     */
    protected clearTimer(): void {
        if (!this.timer) {
            return;
        }

        clearTimeout(this.timer);
        this.timer = null;
    }

    /**
     * Планирует следующий шаг цикла.
     *
     * Вычисляет задержку до `nextExecutionTime`:
     * - Если задержка <= 0, шаг запускается немедленно через `queueMicrotask`,
     *   чтобы избежать блокировки события и дать возможность обработать микрозадачи.
     * - Иначе устанавливается `setTimeout` на оставшееся время.
     *
     * Перед установкой нового таймера предыдущий гарантированно очищается.
     */
    protected scheduleStep(): void {
        if (!this.running) {
            return;
        }

        const delay = this.nextExecutionTime - this.time;
        this.clearTimer();

        if (delay <= 0) {
            queueMicrotask(this.step);
            return;
        }

        this.timer = setTimeout(
            this.step,
            delay
        );
    }

    /**
     * Непосредственно выполняет один шаг цикла.
     *
     * Логика:
     * 1. Если цикл остановлен или коллекция пуста — сбрасывает состояние через `reset()`.
     * 2. Вызывает абстрактный `_stepCycle()`.
     * 3. В случае ошибки делегирует её в `onError`.
     * 4. Вычисляет время следующего выполнения, корректируя `nextExecutionTime`:
     *    - Прибавляет `duration`, сохраняя «идеальное» расписание.
     *    - Если после прибавления `nextExecutionTime` всё ещё не превышает текущее время,
     *      происходит пересинхронизация: `nextExecutionTime` устанавливается в
     *      `now + duration`, чтобы избежать накопления отставания.
     * 5. Запускает планирование следующего шага.
     *
     * Оформлен как стрелочное свойство для сохранения контекста `this` при передаче
     * в `setTimeout` / `queueMicrotask`.
     */
    private step = (): void => {
        if (!this.running || this.size === 0) {
            this.reset();
            return;
        }

        try {
            this._stepCycle();
        } catch (error) {
            this.onError(error);
        }

        const now = this.time;

        this.nextExecutionTime += this.options.duration;

        /**
         * Если цикл ушёл слишком далеко назад,
         * пересинхронизируемся.
         */
        if (this.nextExecutionTime <= now) {
            this.nextExecutionTime =
                now + this.options.duration;
        }

        this.scheduleStep();
    };

    /**
     * Обработчик ошибок, возникших во время выполнения `_stepCycle()`.
     *
     * По умолчанию выводит ошибку в консоль. Может быть переопределён в наследниках.
     *
     * @param error - перехваченная ошибка.
     */
    protected onError(error: unknown): void {
        console.error(
            "[CycleSystem] cycle error:",
            error
        );
    }

    /**
     * Абстрактный метод, реализующий полезную нагрузку одного шага цикла.
     *
     * Вызывается периодически с интервалом `duration`, пока коллекция не пуста
     * и цикл запущен. Должен быть определён в конкретном классе-наследнике.
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
    protected _stepCycle() {
        for (const item of this) {
            // Пропускаем элементы, не прошедшие фильтр
            if (!this.options.filter(item)) continue;

            try {
                const result = this.options.execute(item);

                setImmediate(() => {
                    // Если результат – Promise, обрабатываем возможные ошибки асинхронно
                    if (result instanceof Promise) {
                        result.catch((err) => {
                            console.error("[TaskCycle] Async execution error:", err);
                            this.delete(item);
                        });
                    }
                });
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
    protected _stepCycle() {
        for (const item of this) {
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