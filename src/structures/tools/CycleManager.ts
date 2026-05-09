import { SetArray } from "#structures/array/index.js";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла с точным управлением временем
 * @class DefaultCycleSystem
 * @extends SetArray
 * @abstract
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    /** Последняя зафиксированная длительность цикла (целевая) */
    private lastDuration: number = 0;

    /** Абсолютное время следующего запланированного выполнения (ms) */
    private nextExecutionTime: number = 0;

    /** Идентификатор активного таймера */
    private timer: NodeJS.Timeout | NodeJS.Immediate | null = null;

    /**
     * @description Текущее время в миллисекундах (высокая точность)
     * @protected
     */
    protected get time(): number {
        return performance.now();
    };

    /**
     * @description Ожидаемое время следующего шага цикла
     * @returns number (0 если цикл не активен)
     * @public
     */
    public get insideTime(): number {
        return this.nextExecutionTime;
    };

    /**
     * @description Последний целевой интервал цикла
     * @returns number
     * @public
     */
    public get delay(): number {
        return this.lastDuration;
    };

    /**
     * @description Конструктор
     * @param options - конфигурация цикла
     * @throws {Error} если duration <= 0
     */
    public constructor(public options: SyncCycleConfig<T> | AsyncCycleConfig<T>) {
        super();
        if (options.duration <= 0) {
            throw new Error("Duration must be a positive number");
        }
        this.lastDuration = options.duration;
    };

    /**
     * @description Добавляет элемент в очередь и запускает цикл при необходимости
     * @param item - элемент для добавления
     * @returns this
     */
    public add(item: T): this {
        // Вызов кастомного обработчика добавления
        if (this.options.custom?.push) {
            this.options.custom.push(item);
        }

        // Удаляем дубликат, если уже существует
        if (this.has(item)) this.delete(item);
        super.add(item);

        // Запуск цикла при первом добавленном элементе
        if (this.size === 1 && !this.nextExecutionTime) {
            const now = this.time;
            this.nextExecutionTime = now + this.options.duration;
            // Используем setImmediate для немедленного, но асинхронного старта
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
        const existed = this.has(item);
        if (!existed) return false;

        if (this.options.custom?.remove) {
            this.options.custom.remove(item);
        }

        super.delete(item);
        return true;
    };

    /**
     * @description Полная очистка очереди и остановка цикла
     */
    public reset(): void {
        this.clearTimer();
        this.clear();          // очистка SetArray
        this.nextExecutionTime = 0;
        this.lastDuration = 0;
    };

    /**
     * @description Очищает активный таймер, если он существует
     * @protected
     */
    protected clearTimer(): void {
        if (!this.timer) return;

        if ("hasRef" in this.timer) clearTimeout(this.timer as NodeJS.Timeout);
        else clearImmediate(this.timer as NodeJS.Immediate);
        this.timer = null;
    };

    /**
     * @description Планирует следующий шаг цикла с учётом времени выполнения
     * @protected
     */
    protected scheduleStep(): void {
        const delay = Math.max(this.options.duration, this.nextExecutionTime - this.time);
        this.clearTimer();

        if (delay <= 0) {
            // Мы уже отстаем, выполняем следующий шаг максимально быстро
            this.timer = setImmediate(this.step);
        } else {
            // Обычное планирование
            this.timer = setTimeout(this.step, delay);
        }
    };

    /**
     * @description Основной шаг цикла
     * @private
     */
    private step = (): void => {
        // Если очередь пуста – останавливаем цикл
        if (this.size === 0) return this.reset();

        try {
            // Выполнение полезной нагрузки (переопределяется в наследниках)
            this._stepCycle();
        } catch (error) {
            // Логируем критические ошибки, но не даём циклу упасть
            console.error("[CycleSystem] Unhandled error in _stepCycle:", error);
        }

        // Обновляем время следующего выполнения (устойчиво к дрейфу)
        const now = this.time;
        this.nextExecutionTime += this.options.duration;

        // Если мы сильно отстали (например, из-за долгой обработки),
        // сбрасываем nextExecutionTime, чтобы избежать каскадного отставания
        if (this.nextExecutionTime <= now) {
            this.nextExecutionTime = now + this.options.duration;
        }

        this.lastDuration = this.options.duration;

        // Планируем следующий шаг
        this.scheduleStep();
    };

    /**
     * @description Абстрактный метод, выполняющий полезную работу на каждом шаге
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
    protected _stepCycle(): void {
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
    protected _stepCycle(): void {
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