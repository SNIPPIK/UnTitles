import { performance } from "perf_hooks";
import { SetArray } from "#structures";

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
    private performance: number = 0;

    /**
     * @description Последний записанное значение performance.now(), нужно для сглаживания лага
     * @private
     */
    private prevEventLoopLag: number = 0;

    /**
     * @description Последний сохраненный временной интервал
     * @private
     */
    private lastDelay: number = 0;

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
     * @description Последний зафиксированный разбег во времени
     * @returns number
     * @public
     */
    public get drifting(): number {
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
     * @description Высчитываем задержку шага
     * @param duration - Истинное время шага
     * @private
     */
    private set delay(duration: number) {
        // Получаем следующее время
        const expectedTime = this.startTime + this.tickTime + duration;

        // Корректируем шаги, для точности цикла
        const step = Math.max(1, (this.time - expectedTime) / duration);

        // Делаем шаг
        const timeCorrection = step * duration;
        this.tickTime += timeCorrection;
        this.lastDelay = timeCorrection;
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
    public reset(): void {
        this.clear(); // Удаляем все объекты

        this.startTime = 0;
        this.tickTime = 0;
        this.lastDelay = 0;

        // Чистимся от drift составляющих
        this.drift = 0;

        // Чистим performance.now
        this.performance = 0;
        this.prevEventLoopLag = 0

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
    protected _stepCheckTimeCycle = (duration: number): void => {
        // Проверяем цикл на наличие объектов
        if (this.size === 0) return this.reset();

        // Высчитываем время шага
        this.delay = duration;

        // Запускаем таймер
        return this._runTimeout(this.insideTime, this._stepCycle);
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @returns void
     * @protected
     * @readonly
     */
    protected _stepCheckTimeCycleDrift = (duration: number): void => {
        if (this.size === 0) return this.reset();

        // Высчитываем время шага
        this.delay = duration;

        // Коррекция event loop lag
        const lags = this._calculateLags(this.lastDelay);

        // Следующее время шага
        const nextTargetTime = this.insideTime + this.drift - lags;

        // Запускаем шаг
        this._runTimeout(nextTargetTime, () => {
            // EMA сглаживание дрейфа
            const tickStart = this.time + this.lastDelay;
            this._stepCycle();
            const tickEnd = this.time;

            // Сглаживание дрейфа
            this.drift = this._compensator(0.5, this.drift, tickEnd - tickStart);
        });
    };

    /**
     * @description Функция запуска timeout или immediate функции
     * @param actualTime  - Внутренне время с учетом прошлого тика
     * @param callback    - Функция для высчитывания
     * @returns void
     * @protected
     * @readonly
     */
    protected _runTimeout = (actualTime: number, callback: () => void): void => {
        const delay = Math.max(0, actualTime - this.time);

        (delay < 1 ? process.nextTick : setTimeout)(callback, delay);
    };

    /**
     * @description Высчитываем задержки event loop
     * @param duration - Размер шага
     * @protected
     * @readonly
     */
    protected _calculateLags = (duration: number) => {
        // Коррекция event loop lag
        const performanceNow = performance.now();
        const driftEvent = this.performance ? Math.max(0, (performanceNow - this.performance) - duration) : 0;
        this.performance = performanceNow;

        // Смягчение event loop lag
        return this.prevEventLoopLag = this.prevEventLoopLag !== undefined ? this._compensator(0.95, this.prevEventLoopLag, driftEvent): driftEvent;
    };

    /**
     * @description Сглаживание дрифта времени, смягчает новый по сравнению со старым
     * @param alpha - Значение для сглаживания
     * @param old - Старое время
     * @param current - Новое время
     * @private
     */
    private _compensator = (alpha: number, old: number, current: number) => {
        return alpha * old + (1 - alpha) * current;
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
        this.options?.custom?.step?.();

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
        readonly step?: () => void;
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