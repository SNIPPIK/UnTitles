/**
 * @author SNIPPIK
 * @description Базовый класс цикла
 * @class BaseCycle
 */
abstract class BaseCycle<T = unknown> {
    /**
     * @description База с объектами
     * @protected
     * @readonly
     */
    public readonly array = new Array<T>();

    /**
     * @description Время через которое надо будет выполнить функцию
     * @private
     */
    protected time: number = 0;

    /**
     * @description Выполняет шаг цикла с учётом точного времени следующего запуска
     * @protected
     */
    protected _stepCycle: () => void;

    /**
     * @description Проверяем время для запуска цикла повторно
     * @readonly
     * @private
     */
    protected _stepCheckTimeCycle = (duration: number) => {
        // Если запущен стандартный цикл.
        // Высчитываем время для выполнения
        this.time += duration;

        // Записываем время в переменную для проверки
        let time = Math.max(0, this.time - Date.now());

        // Выполняем функцию через ~time ms
        setTimeout(this._stepCycle, time);
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add(item: T): void {
        const existing = this.array.includes(item);
        if (existing) this.remove(item);
        this.array.push(item);

        // Запускаем цикл
        if (this.array.length === 1 && this.time === 0) {
            this.time = Date.now();
            setImmediate(this._stepCycle);
        }
    };

    /**
     * @description Проверяет, существует ли элемент
     * @param item Элемент типа T
     * @public
     */
    public has(item: T): boolean {
        return this.array.includes(item);
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove(item: T): void {
        const index = this.array.indexOf(item);
        if (index === -1) return;

        this.array.splice(index, 1);
    };

    /**
     * @description Очищает весь массив
     * @protected
     */
    protected clear(): void {
        this.array.splice(0, this.array.length);
        this.time = 0;
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
        else if (this.array.includes(item)) this.remove(item);

        super.add(item);
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove = (item: T) => {
        const index = this.array.indexOf(item);

        // Если есть объект в базе
        if (index !== -1) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            this.array.splice(index, 1);
        }
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @readonly
     * @private
     */
    protected _stepCycle = () => {
        // Если нет объектов
        if (this.array?.length === 0) {
            this.time = 0;
            return;
        }

        // Запускаем цикл
        for (let i = this.array.length; i > 0; i--) {
            const item = this.array[i - 1];

            // Если объект не готов
            if (!this.options.filter(item)) continue;

            try {
                this.options.execute(item);
            } catch (error) {
                this.remove(item);
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
        super();
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public add = (item: T) => {
        if (this.options.custom?.push) this.options.custom?.push(item);
        else if (this.array.includes(item)) this.remove(item);

        super.add(item);
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove = (item: T) => {
        const index = this.array.indexOf(item);

        // Если есть объект в базе
        if (index !== -1) {
            if (this.options.custom?.remove) this.options.custom.remove(item);
            this.array.splice(index, 1);
        }
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @readonly
     * @private
     */
    protected _stepCycle = async () => {
        // Если нет объектов
        if (this.array?.length === 0) {
            this.time = 0;
            return;
        }

        // Запускаем цикл
        for (let i = this.array.length; i > 0; i--) {
            const item = this.array[i - 1];

            // Если объект не готов
            if (!this.options.filter(item)) continue;

            try {
                const bool  = await this.options.execute(item);

                // Если ответ был получен
                if (!bool) this.remove(item);
            } catch (error) {
                this.remove(item);
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