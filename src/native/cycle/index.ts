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
    /** Следующее запланированное время запуска (в ms, с плавающей точкой) */
    protected startTime: number = 0;

    /** Уникальный ID C++ таймера */
    protected nativeId: number = null;

    /**
     * @description Метод получения времени для обновления времени цикла
     * @default Date.now
     * @returns number
     * @protected
     */
    protected get time(): number {
        return performance.now();
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @constructor
     * @public
     */
    public constructor(public options: SyncCycleConfig<T> | AsyncCycleConfig<T>) {
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): this {
        if (this.options.custom?.push) this.options.custom?.push(item);
        if (this.has(item)) this.delete(item);
        super.add(item);

        // Запускаем цикл сразу после добавления первого элемента
        if (this.size === 1 && !this.startTime) {
            setImmediate(() => {
                this.startTime = this.time;
                this._runTimeout();
            });
        }

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
     * @description Чистка цикла от всего
     * @returns void
     * @public
     */
    public reset(): void {
        this.clear(); // Удаляем все объекты

        this.startTime = 0;

        if (this.nativeId !== null) {
            NativeCycle.stop(this.nativeId);
            this.nativeId = null;
        }
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @returns void
     * @protected
     */
    protected _runTimeout = (): void => {
        if (this.nativeId) this.reset();

        this.nativeId = NativeCycle.start(this.options.duration, async (shotTimeMs: number) => {
            await this.step();

            const now = performance.now();
            // shotTimeMs — это сколько мс прошло ВНУТРИ C++ с момента старта
            // realElapsed — сколько мс прошло ВНУТРИ JS с момента старта
            const realElapsed = now - this.startTime;

            // Лаг — это разница между тем, когда C++ выстрелил, и когда JS получил управление
            const lag = realElapsed - shotTimeMs;

            // Отправляем лаг в микросекундах для C++
            NativeCycle.lag(this.nativeId, Math.max(this.size, Math.floor(lag * 1024)));
        });
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска | Полный запрет на promise
     * @returns number
     * @protected
     * @abstract
     */
    protected abstract step: () => Promise<void>;

    /**
     * @description Вынесенная логика обработки ошибок для чистоты кода
     * @param error - Ошибка
     * @param item - Объект с ошибкой
     * @protected
     */
    protected handleStepError(error: unknown, item: T): void {
        this.delete(item);

        console.error(`[StepCycle Error]: Item failed execution. Removed from cycle.`, {
            error: error instanceof Error ? error.message : error,
            item
        });
    };
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
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected step = async () => {
        const { filter, execute, custom } = this.options;

        for (const item of this) {
            // Пропускаем объекты, не прошедшие фильтрацию
            if (!filter(item)) continue;

            try {
                execute(item);
            } catch (error) {
                this.handleStepError(error, item);
            }
        }

        // Выполнение модифицированного шага
        custom?.step?.();
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
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected step = async () => {
        for (const item of this) {
            if (!this.options.filter(item)) continue;
            this.runItem(item);
        }
    };

    /**
     * @description Обработка обещаний
     * @param item - объект с обещанием
     * @private
     */
    private runItem(item: T): void {
        (this.options.execute(item) as Promise<boolean>)
            .then(ok => {
                if (!ok) this.delete(item);
            })
            .catch(err => {
                this.handleStepError(err, item);
            });
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
 * @interface SyncCycleConfig
 * @private
 */
interface SyncCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => Promise<void> | void;
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций PromiseCycle
 * @interface AsyncCycleConfig
 * @private
 */
interface AsyncCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => Promise<boolean>;
}



/**
 * @author SNIPPIK
 * @description Интеграция C++ таймера с node.js
 */
const NativeCycle: NativeCycle = require('../../../Release/cycle_native.node');

/**
 * @author SNIPPIK
 * @description Прямой интерфейс C++ аддона
 */
interface NativeCycle {
    /**
     * @param interval Интервал в мс
     * @param callback Функция, принимающая время выстрела (timestamp в микросекундах)
     * @returns ID воркера
     */
    start(interval: number, callback: (timestamp: number) => void): number;

    /**
     * @param id ID воркера
     */
    stop(id: number): void;

    /**
     * @param id ID воркера
     * @param lagMicroseconds Задержка в микросекундах для коррекции
     */
    lag(id: number, lagMicroseconds: number): void;
}