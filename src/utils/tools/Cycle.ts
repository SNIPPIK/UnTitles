/**
 * @author SNIPPIK
 * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
 * @class Cycle
 * @abstract
 * @public
 */
export abstract class Cycle<T = unknown> {
    /**
     * @description Данные для работы цикла
     * @readonly
     * @private
     */
    private readonly _data: {
        /**
         * @description База с объектами
         */
        array: T[];

        /**
         * @description Время через которое надо будет выполнить функцию
         */
        time: number;
    };

    /**
     * @description Параметры для работы цикла
     * @readonly
     * @public
     */
    public readonly _config: TimeCycleConfig<T>;

    /**
     * @description Выдаем коллекцию
     * @public
     */
    public get array() {
        return this._data.array;
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @protected
     */
    protected constructor(options: TimeCycleConfig<T>) {
        this._data = { array: [], time: 0 };
        this._config = {
            name: "timeCycle",
            execute: null,
            filter: null,
            duration: 10e3,
            ...options
        };
    };

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public set = (item: T) => {
        if (this._config.custom?.push) this._config.custom?.push(item);
        else if (this._data.array.includes(item)) this.remove(item);

        // Добавляем данные в цикл
        this._data.array.push(item);

        // Запускаем цикл
        if (this._data.array?.length === 1 && this._data.time === 0) {
            this._data.time = Date.now();
            setImmediate(this._stepCycle);
        }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove = (item: T) => {
        const index = this._data.array.indexOf(item);

        // Если есть объект в базе
        if (index !== -1) {
            if (this._config.custom?.remove) this._config.custom.remove(item);
            this._data.array.splice(index, 1);
        }
    };

    /**
     * @description Ищем есть ли объект в базе
     * @param item - Объект T
     * @public
     */
    public match = (item: T) => {
        if (this.array.length === 0) return false;

        // Ищем есть и в базе этот объект
        return this.array.indexOf(item) !== -1;
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @readonly
     * @private
     */
    private _stepCycle = () => {
        // Если нет объектов
        if (this._data.array?.length === 0) {
            this._data.time = 0;
            return;
        }

        // Запускаем цикл
        for (let i = this._data.array.length; i > 0; i--) {
            const item = this._data.array[i - 1];

            // Если объект не готов
            if (!this._config.filter(item)) continue;

            try {
                // Если цикл запущен с режимом обещания
                if (item instanceof Promise) {
                    (this._config.execute(item) as Promise<boolean>)
                        // Если ответ был получен
                        .then((bool) => {
                            if (!bool) this.remove(item);
                        })

                        // Если произошла ошибка при получении ответа
                        .catch((error) => {
                            this.remove(item);
                            console.log(error);
                        });
                }

                // Если запущен стандартный цикл
                else this._config.execute(item);
            } catch (error) {
                this.remove(item);
                console.log(error);
            }
        }

        // Запускаем цикл повторно
        return this._stepCheckTimeCycle();
    };

    /**
     * @description Проверяем время для запуска цикла повторно
     * @readonly
     * @private
     */
    private _stepCheckTimeCycle = () => {
        // Если цикл запущен с режимом обещания.
        // Высчитываем время для выполнения
        if (this._config.duration === "promise") this._data.time += 20e3;

        // Если запущен стандартный цикл.
        // Высчитываем время для выполнения
        else this._data.time += this._config.duration;


        // Записываем время в переменную для проверки
        let time = this._data.time - Date.now();

        // Если время меньше 1 ms
        if (time < 0) time = (20).random(0);

        // Выполняем функцию через ~time ms
        setTimeout(this._stepCycle, time);
    };
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций TimeCycle
 * @private
 */
interface TimeCycleConfig<T> {
    /**
     * @description Имя цикла, для удобства отладки
     * @readonly
     * @public
     */
    readonly name: string;

    /**
     * @description Функция для выполнения
     * @readonly
     * @public
     */
    readonly execute: (item: T) => void | Promise<boolean>;

    /**
     * @description Как фильтровать объекты, вдруг объект еще не готов
     * @readonly
     * @public
     */
    readonly filter: (item: T) => boolean;

    /**
     * @description Время прогона цикла, через n времени будет запущен цикл по новой
     * @readonly
     * @public
     */
    readonly duration: number | "promise";

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