import { SetArray } from "#structures/array";
import { CycleWorker } from "#native";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла
 * @class DefaultCycleSystem
 * @extends SetArray
 * @abstract
 * @private
 */
abstract class DefaultCycleSystem<T = unknown> extends SetArray<T> {
    /** Время старта (performance.now()) */
    protected startTime: number | null = null;

    /** Экземпляр нативного воркера */
    protected worker: CycleWorker = null;

    /**
     * @description Метод получения времени
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
        // Инициализируем воркер сразу, чтобы он был готов
        this.worker = new CycleWorker(this.options.duration);
    }

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): this {
        if (this.options.custom?.push) this.options.custom.push(item);
        if (this.has(item)) this.delete(item);
        super.add(item);

        // Если это первый элемент — запускаем нативный поток
        if (this.size === 1 && !this.startTime) {
            this.startTime = this.time;
            this._runTimeout();
        }

        return this;
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @returns boolean
     * @public
     */
    public delete = (item: T): boolean => {
        const hasItem = this.has(item);

        if (hasItem) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            super.delete(item);
        }

        // Если нет больше объектов
        if (this.size === 0) this.reset();

        return true;
    };

    /**
     * @description Чистка цикла от всего
     * @returns void
     * @public
     */
    public reset(): void {
        this.clear();
        this.startTime = null;

        if (this.worker) {
            this.worker.stop();
        }
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @returns void
     * @protected
     */
    protected _runTimeout = (): void => {
        if (!this.worker) return;

        // Передаем callback напрямую в Rust
        this.worker.start(this.step);
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска | Полный запрет на promise
     * @returns number
     * @protected
     * @abstract
     */
    protected abstract step: () => void;

    /**
     * @description Вынесенная логика обработки ошибок для чистоты кода
     * @param error - Ошибка
     * @param item - Объект с ошибкой
     * @protected
     */
    protected handleStepError(error: unknown, item: T): void {
        this.delete(item);
        console.error(`[StepCycle Error]: Removed from cycle.`, {
            error: error instanceof Error ? error.message : error,
            item
        });
    }
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
    protected step = () => {
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
    protected get time() {
        return Date.now();
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @returns Promise<void>
     * @readonly
     * @private
     */
    protected step = () => {
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
    private runItem = (item: T): void => {
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

    /**
     * @description Как фильтровать объекты, вдруг объект еще не готов
     * @readonly
     * @public
     */
    readonly filter: (item: T) => boolean;
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

    /**
     * @description Как фильтровать объекты, вдруг объект еще не готов
     * @readonly
     * @public
     */
    readonly filter: (item: T) => Promise<boolean>;
}