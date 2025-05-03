import {Track} from "@service/player";

/**
 * @author SNIPPIK
 * @description Все треки для проигрывания в плеере, хранит в себе все данные треков
 * @class PlayerTracks
 * @public
 */
export class PlayerTracks<T extends Track> {
    /**
     * @description Хранилище треков, хранит в себе все треки. Прошлые и новые!
     * @readonly
     * @private
     */
    protected _current: T[] = [];

    /**
     * @description Хранилище треков в оригинальном порядке, необходимо для правильной работы shuffle
     * @readonly
     * @private
     */
    protected _original: T[] = [];

    /**
     * @description Текущая позиция в списке
     * @private
     */
    protected _position = 0;

    /**
     * @description Тип повтора
     * @private
     */
    protected _repeat = RepeatType.None;

    /**
     * @description Смешивание треков
     * @private
     */
    protected _shuffle = false;

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
        return this._current[this.position];
    };

    /**
     * @description Кол-во треков в очереди с учетом текущей позиции
     * @return number
     * @public
     */
    public get size() {
        return this._current.length - this.position;
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
     * @description Перетасовка треков, так-же есть поддержка полного восстановления
     * @public
     */
    public set shuffle(bol: boolean) {
        // Если перетасовка выключена
        if (!this._shuffle) {
            let currentIndex = this.size;

            // Записываем треки до перетасовки
            this._original.push(...this._current);

            // Хотя еще остались элементы, которые нужно перетасовать...
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;

                // Текущий трек не трогаем
                if (currentIndex !== this.position && randomIndex !== this.position) {
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
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     */
    public push = (track: T) => {
        // Если включена перетасовка, то добавляем треки в оригинальную очередь
        if (this._shuffle) this._original.push(track);

        // Добавляем трек в текущую очередь
        this._current.push(track);
    };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     */
    public remove = (position: number) => {
        // Если трек удаляем из виртуально очереди, то и из оригинальной
        if (this._shuffle) {
            const index = this._original.indexOf(this._current[position]);
            if (index > -1) this._original.splice(index, 1);
        }

        // Удаляем из очереди
        this._current.splice(position, 1);

        // Меняем позицию, есть она не равна 0
        if (this._position !== 0) this._position = this._position - 1;
    };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     */
    public get = (position: number ) => {
        return this._current[position];
    };

    /**
     * @description Ищем позицию в базе
     * @param track - Искомый трек
     */
    public indexOf = (track: T) => {
        return this._current.indexOf(track);
    };


    /**
     * @description Получаем <указанное> кол-во треков
     * @param size - При -5 будут выданы выданные последние до текущего трека, при +5 будут выданы следующие треки
     * @param sorting - При включении треки перейдут в string[]
     */
    public array = (size: number, sorting: boolean = false) => {
        const position = this._position;

        // Сортируем треки в строки
        if (sorting) {
            let number = 0;

            // Создаем Array
            return this._current.ArraySort(size, (track) => {
                number++;
                return `\`${number}\` - ${track.name_replace}`;
            }, "\n");
        }

        // Выдаем список треков
        if (size < 0) return this._current.slice(position - 1 - size, position - 1 - size);
        return this._current.slice(position + 1, position + size);
    };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        return this._current.reduce((total: number, item) => total + (item.time.total || 0), 0).duration();
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