import { SetArray } from "#structures";

/**
 * @author SNIPPIK
 * @description 2 часа в миллисекундах
 * @const ResetTime
 */
const ResetTime = 1000 * 60 * 60 * 2;

/**
 * @author SNIPPIK
 * @description Базовый класс цикла
 * @class BaseCycle
 * @extends SetArray
 * @abstract
 * @private
 */
abstract class BaseCycle<T = unknown> extends SetArray<T> {
    /**
     * @description Последний записанное значение performance.now(), нужно для улавливания event loop lags
     * @private
     */
    private performance: number;

    /**
     * @description Последний сохраненный временной интервал
     * @private
     */
    private lastDelay: number;

    /**
     * @description Следующее запланированное время запуска (в ms, с плавающей точкой)
     * @private
     */
    private startTime: number = 0;

    /**
     * @description Время для высчитывания
     * @private
     */
    private tickTime: number = 0;

    /**
     * @description Временное число отставания цикла в миллисекундах
     * @private
     */
    private drift: number = 0;

    /**
     * @description Разбег между указанным duration
     * @returns number
     * @public
     */
    public get drifting(): number {
        // Высчитываем реальный drift, между временем цикла и реальным
        return this.drift;
    };

    /**
     * @description Время циклической системы изнутри
     * @returns number
     * @public
     */
    public get insideTime(): number {
        return this.startTime + this.tickTime;
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
     * @description Метод получения времени для обновления времени цикла
     * @default Date.now
     * @returns number
     * @protected
     */
    protected get time(): number {
        return Date.now();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): this {
        const existing = this.has(item);

        // Если добавляется уже существующий объект
        if (existing) this.delete(item);

        super.add(item);

        // Запускаем цикл, если добавлен первый объект
        if (this.size === 1 && this.startTime === 0) {
            this.startTime = this.time;
            setImmediate(this._stepCycle);
        }

        return this;
    };

    /**
     * @description Чистка цикла от всего
     * @returns void
     * @public
     */
    public reset = (): void => {
        this.clear(); // Удаляем все объекты

        this.startTime = 0;
        this.tickTime = 0;
        this.lastDelay = null;

        // Чистимся от drift составляющих
        this.drift = 0;

        // Чистим performance.now
        this.performance = null;

        // Запускаем Garbage Collector
        setImmediate(() => {
            if (typeof global.gc === "function") global.gc();
        });
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска
     * @returns void
     * @protected
     * @abstract
     */
    protected abstract _stepCycle: () => void;

    /**
     * @description Проверяем время для запуска цикла повторно, без учета дрифта
     * @returns void
     * @protected
     * @readonly
     */
    protected readonly _stepCheckTimeCycle = (duration: number): void => {
        // Проверяем цикл на наличие объектов
        if (this.size === 0) return this.reset();

        // Получаем следующее время
        const actualTime = this.startTime + this.tickTime + duration;

        // Время тика
        this.tickTime += duration;

        // Запускаем таймер
        return this._runTimeout(duration, actualTime, this._stepCycle);
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @returns void
     * @protected
     * @readonly
     */
    protected readonly _stepCheckTimeCycleDrift = (duration: number): void => {
        if (this.size === 0) return this.reset();

        const expectedNextTime = this.startTime + this.tickTime + duration;

        // Корректируем шаги, для точности цикла
        const correction = Math.floor((this.time - expectedNextTime) / duration);
        const driftSteps = Math.max(1, correction);
        const tickTime = driftSteps * duration;
        this.tickTime += tickTime;

        // Коррекция event loop lag
        const performanceNow = performance.now();
        const eventLoopLag = this.performance
            ? Math.max(0, (performanceNow - this.performance) - (tickTime + driftSteps))
            : duration;
        this.performance = performanceNow;

        // Финальная цель для next timeout (с учетом лагов и дрейфа)
        const nextTargetTime = (expectedNextTime + this.drift) - eventLoopLag;

        // Запускаем таймер
        this._runTimeout(duration, nextTargetTime, () => {
            const tickStart = this.time;

            // Делаем шаг
            this._stepCycle();

            const tickEnd = this.time;
            const actualStepDuration = tickEnd - tickStart;

            // Обновляем drift на основе фактического выполнения
            this.drift = Math.max(0, actualStepDuration);
        });
    };

    /**
     * @description Функция запуска timeout или immediate функции
     * @param duration - Реальное время
     * @param actualTime  - Внутренне время с учетом прошлого тика
     * @param callback    - Функция для высчитывания
     * @returns void
     * @protected
     * @readonly
     */
    protected readonly _runTimeout = (duration: number, actualTime: number, callback: () => void): void => {
        const delay = Math.max(0, actualTime - this.time);

        // Периодический сброс каждые N время для стабилизации
        if (this.tickTime >= ResetTime) {
            this.startTime = this.time;
            this.tickTime = 0;
            this.drift = 0;
            this.lastDelay = null;
        }

        // Если delay слишком мал
        if (delay <= 0) {
            if (this.lastDelay && this.lastDelay < 1) {
                this.lastDelay = duration;
                setTimeout(callback, duration);
                return;
            }

            // Переходим к следующему шагу в следующем тике
            process.nextTick(this._stepCycle);
            return;
        }

        this.lastDelay = delay;
        setTimeout(callback, delay);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления циклами
 * @class TaskCycle
 * @abstract
 * @public
 */
export abstract class TaskCycle<T = unknown> extends BaseCycle<T> {
    /**
     * @description Метод получения времени для обновления времени цикла
     * @protected
     * @default Date.now
     */
    protected get time(): number {
        if (!this.options.drift) return Number(process.hrtime.bigint()) / 1e6;
        return Date.now();
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @protected
     */
    protected constructor(public readonly options: TaskCycleConfig<T>) {
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @returns this
     * @public
     */
    public add = (item: T): this => {
        if (this.options.custom?.push) this.options.custom?.push(item);
        else if (this.has(item)) this.delete(item);

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
        const index = this.has(item);

        // Если есть объект в базе
        if (index) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            super.delete(item);
        }

        return true;
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected _stepCycle = async (): Promise<void> => {
        await this.options?.custom?.step?.();

        // Запускаем цикл
        for (const item of this) {
            // Если объект не готов
            if (!this.options.filter(item)) continue;

            try {
                this.options.execute(item);
            } catch (error) {
                this.delete(item);
                console.log(error);
            }
        }

        // Запускаем цикл повторно
        if (this.options.drift) return this._stepCheckTimeCycle(this.options.duration);
        return this._stepCheckTimeCycleDrift(this.options.duration);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления promise циклами
 * @class PromiseCycle
 * @abstract
 * @public
 */
export abstract class PromiseCycle<T = unknown> extends BaseCycle<T> {
    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @protected
     */
    protected constructor(public readonly options: PromiseCycleConfig<T>) {
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @returns this
     * @public
     */
    public add = (item: T): this => {
        if (this.options.custom?.push) this.options.custom?.push(item);
        else if (this.has(item)) this.delete(item);

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
        const index = this.has(item);

        // Если есть объект в базе
        if (index) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            super.delete(item);
        }

        return true;
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected _stepCycle = async (): Promise<void> => {
        for (const item of this) {
            // Если объект не готов
            if (!this.options.filter(item)) continue;

            try {
                const bool  = await this.options.execute(item);

                // Если ответ был получен
                if (!bool) this.delete(item);
            } catch (error) {
                this.delete(item);
                console.log(error);
            }
        }

        // Запускаем цикл повторно
        if (this.options.drift) return this._stepCheckTimeCycle(30e3);
        return this._stepCheckTimeCycleDrift(30e3);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций BaseCycle
 * @private
 */
interface BaseCycleConfig<T> {
    /**
     * @description Допустим ли drift, если требуется учитывать дрифт для стабилизации цикла
     * @readonly
     * @public
     */
    readonly drift: boolean;

    /**
     * @description Как фильтровать объекты, вдруг объект еще не готов
     * @readonly
     * @public
     */
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
        readonly step?: () => Promise<void>;
    }
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций SyncCycle
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
 * @description Интерфейс для опций AsyncCycle
 * @private
 */
interface PromiseCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => Promise<boolean>;
}