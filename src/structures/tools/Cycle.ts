import { SetArray } from "#structures";

/**
 * @author SNIPPIK
 * @description Базовый класс цикла
 * @class BaseCycle
 */
abstract class BaseCycle<T = unknown> extends SetArray<T> {
    /**
     * @description Следующее запланированное время запуска (в ms, с плавающей точкой)
     * @private
     */
    private startTime: number = 0;

    /**
     * @description Время для высчитывания
     * @private
     */
    private loop: number = 0;

    /**
     * @description Кол-во пропусков цикла
     * @private
     */
    private missCounter = 0;

    /**
     * @description Тип таймера, задает точность таймера
     * @protected
     */
    private readonly timer: "max" | "low";

    /**
     * @description Получение текущего времени для вычитания и получения точного времени
     * @private
     */
    private get localTime() {
        if (this.timer === "low") return Date.now();
        return performance.now();
    };

    /**
     * @description Задаем параметр для создания класса
     * @param duration - Время интервала для таймера, значение менее 1 сек, будут использовать более точный таймер
     * @protected
     */
    protected constructor(duration: number) {
        super();
        this.timer = duration < 100 ? "max" : "low";
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска
     * @protected
     */
    protected abstract _stepCycle: () => void;

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T) {
        const existing = this.has(item);

        // Если добавляется уже существующий объект
        if (existing) this.delete(item);

        super.add(item);

        // Запускаем цикл, если добавлен первый объект
        if (this.size === 1 && this.startTime === 0) {
            this.startTime = this.localTime;
            setImmediate(this._stepCycle);
        }

        return this;
    };

    /**
     * @description Проверяем время для запуска цикла повторно
     * @readonly
     * @private
     */
    protected _stepCheckTimeCycle = (duration: number) => {
        // Если нет объектов
        if (this.size === 0) {
            this.startTime = 0;
            this.loop = 0;
            this.missCounter = 0;
            return;
        }

        const nextTime = this.startTime + (this.loop * duration);              // Следующее время для определения
        const delay = Math.max(0, nextTime - this.localTime);         // Цельный целевой интервал + остаток от предыдущих циклов

        // Номер прогона цикла
        this.loop++;

        // Цикл отстал, подтягиваем loop вперёд
        if (delay <= 0) {
            setImmediate(this._stepCycle);
            return;
        }

        // Принудительная стабилизация
        else if (this.missCounter > 5) {
            this.startTime = this.localTime;
            this.loop = 0;
            this.missCounter = 0;

            setTimeout(this._stepCycle, duration);
            return;
        }

        // Иначе ждем нужное время
        setTimeout(() => {
            // Если цикл высокоточный, высчитываем дрифт цикла
            if (this.timer === "max") {
                const drift = this.localTime - nextTime;

                // Если отставание более 5 ms
                if (drift > 5) {
                    //console.log(`Drift: ${drift}ms`);
                    this.missCounter++;
                }
            }

            return this._stepCycle();
        }, delay);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления циклами
 * @class SyncCycle
 * @abstract
 * @public
 */
export abstract class SyncCycle<T = unknown> extends BaseCycle<T> {
    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @protected
     */
    protected constructor(public readonly options: SyncCycleConfig<T>) {
        super(options.duration);
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add = (item: T) => {
        if (this.options.custom?.push) this.options.custom?.push(item);
        else if (this.has(item)) this.delete(item);

        super.add(item);
        return this;
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
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
     * @readonly
     * @private
     */
    protected _stepCycle = async () => {
        // Запускаем цикл
        for await (const item of this) {
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
        return this._stepCheckTimeCycle(this.options.duration);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для удобного управления promise циклами
 * @class AsyncCycle
 * @abstract
 * @public
 */
export abstract class AsyncCycle<T = unknown> extends BaseCycle<T> {
    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @protected
     */
    protected constructor(public readonly options: AsyncCycleConfig<T>) {
        super(20e3);
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add = (item: T) => {
        if (this.options.custom?.push) this.options.custom?.push(item);
        else if (this.has(item)) this.delete(item);

        super.add(item);
        return this;
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
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
     * @readonly
     * @private
     */
    protected _stepCycle = async () => {
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
        return this._stepCheckTimeCycle(20e3);
    };
}


/**
 * @author SNIPPIK
 * @description Интерфейс для опций BaseCycle
 * @private
 */
interface BaseCycleConfig<T> {
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
         * @description Изменить логику добавления
         * @param item - объект
         * @readonly
         * @public
         */
        readonly push?: (item: T) => void;

        /**
         * @description Изменить логику удаления
         * @param item - объект
         * @readonly
         * @public
         */
        readonly remove?: (item: T) => void;
    }
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций SyncCycle
 * @private
 */
interface SyncCycleConfig<T> extends BaseCycleConfig<T> {
    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => void;

    /**
     * @description Время прогона цикла, через n времени будет запущен цикл по новой
     * @readonly
     * @public
     */
    readonly duration: number;
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций AsyncCycle
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