import { performance } from "node:perf_hooks";
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
    /** Последний записанное значение performance.now(), нужно для улавливания event loop lags */
    private performance: number = 0;

    /** Последний сохраненный временной интервал */
    private lastDelay: number = 0;

    /** Следующее запланированное время запуска (в ms, с плавающей точкой) */
    private startTime: number = 0;

    /** Время для высчитывания */
    private tickTime: number = 0;

    /** Таймер или функция ожидания */
    private timeout: NodeJS.Timeout | NodeJS.Immediate;

    /**
     * @description Время циклической системы изнутри
     * @returns number
     * @public
     */
    public get insideTime(): number {
        return this.startTime + this.tickTime;
    };

    /**
     * @description Метод получения времени для обновления времени цикла
     * @default Date.now
     * @returns number
     * @protected
     */
    protected get time(): number {
        const startTime = process.hrtime.bigint();
        return Number(startTime) / 1_000_000;
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
        // Ожидаемое время следующего запуска (без учета _driftStep/lag)
        const expectedNext = this.startTime + this.tickTime + duration;
        const now = this.time;

        // Сколько шагов "пропустили" по времени (если any)
        let missedSteps = 1;
        if (now > expectedNext) {
            // (now - expectedNext) может быть > duration * N
            const over = (now - expectedNext) / duration;
            missedSteps = Math.max(missedSteps, over);
        }

        const correction = missedSteps * duration;
        this.tickTime += correction;
        this.lastDelay = correction;
    };

    /**
     * @description Высчитываем задержки event loop
     * @protected
     */
    protected get _calculateLags() {
        const now = performance.now();

        // Если это первый тик — просто инициализация
        if (!this.performance) {
            this.performance = now;
            return 0;
        }

        const delta = Math.max(0, now - this.performance - this.lastDelay);
        this.performance = now;

        // Отдаем задержку Event loop
        return delta;
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @public
     */
    public constructor(public options: TaskCycleConfig<T> | PromiseCycleConfig<T>) {
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): this {
        if (this.has(item)) this.delete(item);
        super.add(item);

        // Запускаем цикл сразу после добавления первого элемента
        if (this.size === 1 && !this.startTime) {
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

        // Чистим performance.now
        this.performance = 0;

        // Если есть таймер
        if (this.timeout) this._clearTimeout();
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @returns void
     * @protected
     */
    protected _runStepTimeout = (duration: number): void => {
        // Проверяем цикл на наличие объектов
        if (this.size === 0 || isNaN(duration)) return this.reset();

        // Высчитываем время шага
        this.delay = duration;

        // Следующее время шага
        const nextTargetTime = (this.insideTime + this._calculateLags);

        /* TIMEOUT */

        // Время для выполнения шага
        const delay = Math.max(0, nextTargetTime - this.time);
        this._clearTimeout();

        this.timeout = setTimeout(this._stepCycle, delay);
    };

    /**
     * @description Удаляем таймер или Immediate
     * @protected
     */
    protected _clearTimeout = () => {
        if (!this.timeout) return;
        if ('hasRef' in this.timeout) clearTimeout(this.timeout as NodeJS.Timeout);
        else clearImmediate(this.timeout as NodeJS.Immediate);
        this.timeout = null;
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска
     * @returns void
     * @protected
     * @abstract
     */
    protected abstract _stepCycle: () => void;
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления циклами
 * @class TaskCycle
 * @abstract
 * @public
 */
export abstract class TaskCycle<T = unknown> extends DefaultCycleSystem<T> {

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

        return this._runStepTimeout(this.options.duration);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления promise циклами
 * @class PromiseCycle
 * @abstract
 * @public
 */
export abstract class PromiseCycle<T = unknown> extends DefaultCycleSystem<T> {
    protected get time() { return Date.now(); };

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

        return this._runStepTimeout(30e3);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций DefaultCycleSystem
 * @interface BaseCycleConfig
 * @private
 */
interface BaseCycleConfig<T> {
    /**
     * @description Время прогона цикла, через n времени будет запущен цикл по новой
     * @readonly
     * @public
     */
    duration: number;

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
}