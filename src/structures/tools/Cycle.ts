import { SetArray } from "#structures/array";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла
 * @class DefaultCycleSystem
 * @extends SetArray
 * @abstract
 * @private
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    /** Последний сохраненный временной интервал */
    private lastDelay: number = 0;

    /** Следующее запланированное время запуска (в ms, с плавающей точкой) */
    private startTime: number = 0;

    /** Накопленное время тиков */
    private tickTime: number = 0;

    /** Задержка функции _stepCycle */
    private _driftStep: number = 0;
    private _miss: number = 0;

    /** Таймер или функция ожидания */
    private timeout: NodeJS.Timeout | null = null;

    /**
     * @description Последний зафиксированный разбег во времени (дрифт)
     * @returns number
     * @public
     */
    public get drifting(): number {
        return this._driftStep;
    };

    /**
     * @description Упущенные шаги функции выполнения
     * @public
     */
    public get misses(): number {
        return this._miss;
    };

    /**
     * @description Время циклической системы изнутри (расчетное время следующего тика - дрифт)
     * @returns number
     * @public
     */
    public get insideTime(): number {
        return this.startTime + this.tickTime;
    };

    /**
     * @description Метод получения времени для обновления времени цикла
     * @default process.hrtime
     * @returns number
     * @protected
     */
    protected get time(): number {
        const hr = process.hrtime.bigint();
        return Math.floor(Number(hr / 1_000_000n));
    };

    /**
     * @description Последний зафиксированный промежуток выполнения
     * @returns number
     * @public
     */
    public get delay(): number {
        return this.lastDelay;
    };

    /**
     * @description Высчитываем задержку шага и пропуски
     * @param duration - Истинное время шага
     * @private
     */
    private set delay(duration: number) {
        // Ожидаемое время следующего запуска
        const expectedNext = this.startTime + this.tickTime + duration;
        const now = this.time;

        // Если текущее время больше ожидаемого, значит мы пропустили шаги
        if (now > expectedNext) {
            const diff = now - expectedNext;
            // Считаем сколько полных интервалов пропустили
            const over = Math.floor(diff / duration);
            this._miss = over * duration;
        }
        // Если время сходится
        else this._miss = 0;

        this.tickTime += duration;
        this.lastDelay = duration;
    };

    /**
     * @description Функция выполнения шага с вычетом задержки
     * @protected
     */
    protected get _onceStep() {
        return () => {
            const now = performance.now();

            try {
                this._stepCycle();
            } finally {
                // Фиксируем задержку выполнения функции (Дрифт)
                // FIX: Было (now - performance.now()), что давало отрицательное число
                this._driftStep = Math.max(0, performance.now() - now);
            }
        };
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): this {
        if (this.has(item)) this.delete(item);
        super.add(item);

        // Запускаем цикл сразу после добавления первого элемента, если он еще не запущен
        if (this.size === 1 && !this.startTime) {
            this.startTime = this.time;
            // Используем setImmediate для асинхронного старта
            setImmediate(this._onceStep);
        }

        return this;
    };

    /**
     * @description Чистка цикла от всего
     * @returns void
     * @public
     */
    public reset(): void {
        this.clear(); // Удаляем все объекты
        this.reboot();
    };

    /**
     * @description Подготовка данных цикла для повторного использования
     * @private
     */
    private reboot = () => {
        this.startTime = 0;
        this.tickTime = 0;
        this.lastDelay = 0;

        // Дрифт, он высчитываем задержку выполнения функции
        this._driftStep = 0;
        this._miss = 0;
        this._clearTimeout();
    };

    /**
     * @description Проверяем время для запуска цикла повторно
     * @returns void
     * @protected
     */
    protected _stepCheckTimeCycle = (duration: number): void => {
        // Проверяем цикл на наличие объектов и валидность duration
        if (this.size === 0 || isNaN(duration) || duration <= 0) return this.reset();

        // Высчитываем время шага и обновляем tickTime
        this.delay = duration;

        // Запускаем таймер
        return this._runTimeout(this.insideTime, this._onceStep);
    };

    /**
     * @description Функция запуска timeout
     * @param actualTime  - Внутренне время с учетом прошлого тика
     * @param callback    - Функция для выполнения
     * @returns void
     * @protected
     */
    protected _runTimeout = (actualTime: number, callback: () => void): void => {
        // Рассчитываем реальную задержку до следующего тика
        const delay = Math.max(0, actualTime - this.time - this._driftStep);
        this._clearTimeout();

        this.timeout = setTimeout(callback, delay);
    };

    /**
     * @description Удаляем таймер
     * @protected
     */
    protected _clearTimeout = () => {
        if (!this.timeout) return;
        clearTimeout(this.timeout);
        this.timeout = null;
    };

    /**
     * @description Абстрактный метод самого цикла
     * @protected
     * @abstract
     */
    protected abstract _stepCycle: () => void;
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления циклами (синхронный запуск задач)
 * @class TaskCycle
 * @abstract
 * @public
 */
export class TaskCycle<T = unknown> extends DefaultCycleSystem<T> {
    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @public
     */
    public constructor(public options: TaskCycleConfig<T>) {
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @returns this
     * @public
     */
    public add = (item: T): this => {
        if (this.options.custom?.push) this.options.custom.push(item);
        if (this.has(item)) this.delete(item);

        super.add(item);
        return this;
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @returns boolean
     * @public
     */
    public delete = (item: T) => {
        // Проверяем наличие перед удалением
        if (this.has(item)) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            super.delete(item);
            return true;
        }

        return false;
    };

    /**
     * @description Здесь будет выполнен прогон объектов
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected _stepCycle = async (): Promise<void> => {
        this.options?.custom?.step?.();

        // Запускаем цикл
        for (const item of this) {
            // Если объект не проходит фильтр, пропускаем
            if (!this.options.filter(item)) continue;

            try {
                // В TaskCycle задачи запускаются без await (fire-and-forget внутри цикла),
                // либо синхронно, если execute не возвращает Promise.
                // Ошибки внутри execute должны быть пойманы там же, или пойманы здесь.
                const result = this.options.execute(item);
                if (result instanceof Promise) {
                    result.catch(err => {
                        console.error("Task execution error:", err);
                        this.delete(item);
                    });
                }
            } catch (error) {
                console.error("Task synchronous error:", error);
                this.delete(item);
            }
        }

        // Запускаем цикл повторно через заданный интервал
        return this._stepCheckTimeCycle(this.options.duration);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления promise циклами (последовательное выполнение)
 * @class PromiseCycle
 * @abstract
 * @public
 */
export class PromiseCycle<T = unknown> extends DefaultCycleSystem<T> {
    // Переопределяем time для использования Date.now() (менее точно, но быстрее)
    protected get time() {
        return Date.now();
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @public
     */
    public constructor(public options: PromiseCycleConfig<T>) {
        super();
    };

    public add = (item: T): this => {
        if (this.options.custom?.push) {
            this.options.custom.push(item);
        } else if (this.has(item)) {
            this.delete(item);
        }

        super.add(item);
        return this;
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @returns boolean
     * @public
     */
    public delete = (item: T) => {
        if (this.has(item)) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            super.delete(item);
            return true;
        }
        return false;
    };

    /**
     * @description Прогон объектов с ожиданием (await) каждого шага
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected _stepCycle = async (): Promise<void> => {
        this.options?.custom?.step?.();

        for (const item of this) {
            // Если объект не готов
            if (!this.options.filter(item)) continue;

            try {
                // Ждем выполнения задачи
                const success = await this.options.execute(item);

                // Если execute вернул false, считаем, что задача завершена или провалена окончательно
                if (!success) this.delete(item);
            } catch (error) {
                console.error("Promise cycle error:", error);
                this.delete(item);
            }
        }

        // Запускаем цикл повторно
        return this._stepCheckTimeCycle(this.options.duration ?? 30000);
    };
}

/**
 * @description Общий интерфейс конфигурации
 * @interface BaseCycleConfig
 * @private
 */
interface BaseCycleConfig<T> {
    readonly filter: (item: T) => boolean;

    /**
     * @description Кастомные функции, необходимы для модификации или правильного удаления
     * @readonly
     * @public
     */
    readonly custom?: {
        /**
         * @description Данная функция расширяет функционал добавления, выполняется перед добавлением
         * @param item - объект
         * @readonly
         * @public
         */
        readonly push?: (item: T) => void;

        /**
         * @description Данная функция расширяет функционал удаления, выполняется перед удалением
         * @param item - объект
         * @readonly
         * @public
         */
        readonly remove?: (item: T) => void;

        /**
         * @description Данная функция расширяет функционал шага, выполняется перед шагом
         * @readonly
         * @public
         */
        readonly step?: () => void;
    }
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций TaskCycle
 * @interface TaskCycleConfig
 * @private
 */
interface TaskCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => Promise<void> | void;

    /**
     * @description Время прогона цикла, через n времени будет запущен цикл по новой
     * @readonly
     * @public
     */
    duration: number;
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций PromiseCycle
 * @interface PromiseCycleConfig
 * @private
 */
interface PromiseCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => Promise<boolean>;

    /**
     * @description Время паузы между проходами всего цикла
     * @default 30000
     */
    duration?: number;
}