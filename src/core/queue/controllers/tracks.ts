import { Track } from "#core/queue";

/**
 * @author SNIPPIK
 * @description Класс для управления и хранения треков
 * @class ControllerTracks
 * @public
 */
export class ControllerTracks<T extends Track> {
    /**
     * @description Хранилище треков, хранит в себе все треки. Прошлые и новые!
     * @readonly
     * @private
     */
    private _current: T[] = [];

    /**
     * @description Хранилище треков в оригинальном порядке, необходимо для правильной работы shuffle
     * @readonly
     * @private
     */
    private _original: T[] = [];

    /**
     * @description Текущая позиция в списке
     * @private
     */
    private _position = 0;

    /**
     * @description Тип повтора
     * @private
     */
    private _repeat = RepeatType.None;

    /**
     * @description Смешивание треков
     * @private
     */
    private _shuffle = false;

    /**
     * @description Новая позиция трека в списке
     * @param number - Позиция трека
     * @public
     */
    public set position(number: number) {
        // Переключаем позицию на первый трек
        if (number >= this._current.length) {
            // Если указана позиция больше чем треков в списке
            this._position = 0;
            return;
        }

        // Переключаем с первой позиции на последнею позицию
        else if (number < 0) {
            // Меняем позицию на последнюю доступную
            this._position = this._current.length - 1;
            return;
        }

        // Меняем позицию
        this._position = number;
    };

    /**
     * @description Текущая позиция трека в очереди
     * @return number
     * @public
     */
    public get position() {
        return this._position;
    };

    /**
     * @description Получаем текущий трек
     * @return Track
     * @public
     */
    public get track() {
        return this._current[this._position];
    };

    /**
     * @description Кол-во треков в очереди с учетом текущей позиции
     * @return number
     * @public
     */
    public get size() {
        return this._current.length - this._position;
    };

    /**
     * @description Общее кол-во треков в очереди
     * @return number
     * @public
     */
    public get total() {
        return this._current.length;
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean {
        return this._shuffle;
    };

    /**
     * @description Сохраняем тип повтора
     * @param type - Тип повтора
     * @public
     */
    public set repeat(type) {
        this._repeat = type;
    };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() {
        return this._repeat;
    };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        return this._current.reduce((total, track) => total + (track.time?.total || 0), 0).duration();
    };

    /**
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     * @returns void
     * @public
     */
    public push = (track: T) => {
        // Если включена перетасовка, то добавляем треки в оригинальную очередь
        if (this._shuffle) this._original.push(track);

        // Добавляем трек в текущую очередь
        this._current.push(track);
    };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     * @returns Track
     * @public
     */
    public get = (position: number ) => {
        return this._current[position];
    };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     * @returns void
     * @public
     */
    public remove = (position: number) => {
        // Если трек удаляем из виртуально очереди, то и из оригинальной
        if (this._shuffle) {
            const index = this._original.indexOf(this._current[position]);
            if (index > -1) this._original.splice(index, 1);
        }

        // Удаляем из очереди
        this._current.splice(position, 1);

        // Корректируем позицию, если она больше длины или не равна нулю
        if (this._position > position) {
            this._position--;
        } else if (this._position >= this._current.length) {
            this._position = this._current.length - 1;
        }

        if (this._position < 0) this._position = 0;
    };

    /**
     * @description Ищем позицию в базе
     * @param track - Искомый трек
     * @returns number
     * @public
     */
    public indexOf = (track: T) => {
        return this._current.indexOf(track);
    };

    /**
     * @description Получаем <указанное> кол-во треков
     * @param size - При -5 будут выданы выданные последние от текущей позиции, при +5 будут выданы следующие треки
     * @param position - Позиция с которой будет начат отсчет
     * @returns T[]
     * @public
     */
    public array(size: number, position?: number): T[] {
        const realPosition = position ?? this._position;
        const startIndex = size < 0 ? realPosition + size : realPosition;
        const endIndex = size < 0 ? realPosition : realPosition + size;

        return this._current.slice(startIndex, endIndex);
    };

    /**
     * @description Перетасовка треков, так-же есть поддержка полного восстановления
     * @returns void
     * @public
     */
    public shuffleTracks = (bol: boolean) => {
        // Если перетасовка выключена
        if (!this._shuffle) {
            let currentIndex = this.size;

            // Записываем треки до перетасовки
            this._original = this._current.slice();

            // Хотя еще остались элементы, которые нужно перетасовать...
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;

                // Текущий трек не трогаем
                if (currentIndex !== this._position && randomIndex !== this._position) {
                    // И замените его текущим элементом.
                    [this._current[currentIndex], this._current[randomIndex]] = [this._current[randomIndex], this._current[currentIndex]];
                }
            }
        }

        // Восстанавливаем оригинальную очередь
        else {
            // Меняем треки в текущей очереди на оригинальные
            this._current = this._original;

            // Удаляем оригинальные треки, поскольку они теперь и основной ветке
            this._original = [];
        }

        // Меняем переменную
        this._shuffle = bol;
    };

    /**
     * @description Очищаем текущий класс от треков и прочих параметров
     * @returns void
     * @public
     */
    public clear = () => {
        this._current.length = null;
        this._original.length = null;
        this._current = null;
        this._original = null;

        this._position = null;
        this._repeat = null;
        this._shuffle = null;
    };
}

/**
 * @author SNIPPIK
 * @description Типы повторов
 * @enum RepeatType
 * @public
 */
export enum RepeatType {
    /**
     * @description Повтор выключен
     */
    None = 0,

    /**
     * @description Повтор одного трека
     */
    Song = 1,

    /**
     * @description Повтор всех треков
     */
    Songs = 2
}