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
     * @description Временное число отспавания цикла в милисекундах
     * @public
     */
    public drift: number = 0;

    /**
     * @description История дрифтов, нееобходима для высокоточного цикла
     * @private
     */
    private driftHistory: number[] = [];

    /**
     * @description Кол-во пропусков цикла
     * @private
     */
    private missCounter: number = 0;

    /**
     * @description Проверяем наличия данных в цикле
     * @readonly
     * @private
     */
    private get cleaned(): boolean {
        // Если нет объектов
        if (this.size === 0) {
            this.startTime = 0;
            this.loop = 0;

            // Чистимся от drift состовляющих
            this.drift = 0;
            this.missCounter = 0;
            this.driftHistory.splice(0, this.driftHistory.length);
            return true;
        }

        return false;
    };

    /**
     * @description Метод получения времени для обновления времени цикла
     * @protected
     * @default Date.now
     */
    protected get time(): number {
        return Date.now();
    };

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
            this.startTime = this.time;
            setImmediate(this._stepCycle);
        }

        return this;
    };

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска
     * @protected
     * @abstract
     */
    protected abstract _stepCycle: () => void;

    /**
     * @description Проверяем время для запуска цикла повторно, без учета дрифта
     * @readonly
     * @private
     */
    protected readonly _stepCheckTimeCycle = (duration: number) => {
        // Проверяем цикл на наличие объектов
        if (this.cleaned) return;

        // Номер прогона цикла
        this.loop++;

        const nextTime = this.startTime + (this.loop * duration);
        const delay = Math.max(0, nextTime - this.time);

        // Цикл отстал, подтягиваем loop вперёд
        if (delay <= 0) {
            setImmediate(this._stepCycle);
            return;
        }

        // Иначе ждем нужное время
        setTimeout(this._stepCycle, delay);
    };

    /**
     * @description Проверяем время для запуска цикла повторно с учетом дрифта цикла
     * @readonly
     * @private
     */
    protected readonly _stepCheckTimeCycleDrift = (duration: number) => {
        // Проверяем цикл на наличие объектов
        if (this.cleaned) return;

        const nextTime = (this.startTime + this.loop) - this.drift;
        const delay = Math.max(0, nextTime - this.time);

        // Номер прогона цикла
        this.loop += duration;

        // Цикл отстал, подтягиваем loop вперёд
        if (delay <= 0) {
            setImmediate(this._stepCycle);
            return;
        }

        // Если кол-во дрифта более 1
        else if (this.driftHistory.length > 0) {
            // Сброс drift, для стабилизации цикла
            if (this.missCounter > 20) {
                this.drift = 0;
                this.missCounter = 0;
                this.driftHistory.splice(0, this.driftHistory.length);

                setTimeout(this._stepCycle, delay);
                return;
            }

            // Считаем среднее значение дрифта
            this.drift = this.driftHistory.reduce((a, b) => a + b, 0) / this.driftHistory.length;
            this.missCounter++;
        }

        // Иначе ждем нужное время
        setTimeout(() => {
            const drift = (this.time - nextTime) - this.drift;

            // Если отставание более 0.12 ms
            if (drift > 0.12) {
                this.driftHistory.push(drift);
                if (this.driftHistory.length > 10) this.driftHistory.shift();
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
        super();
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
                await this.options.execute(item);
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
        super();
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
     * @description Допустим ли drift, если требуется учитывать дрифттинг для стабилизации цикла
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
    readonly execute: (item: T) => Promise<void> | void;

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