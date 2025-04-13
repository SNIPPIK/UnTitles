import {Track} from "@service/player";

/**
 * @author SNIPPIK
 * @description Все треки для проигрывания в плеере, хранит в себе все данные треков
 * @class PlayerTracks
 * @public
 */
export class PlayerTracks {
    /**
     * @description База данных для работы с треками
     * @readonly
     * @private
     */
    private readonly _tracks: PlayerTracksData = {
        _current:  [] as Track[],
        _original: [] as Track[],
        _position: 0,
        _repeat: RepeatType.None as RepeatType,
        _shuffle: false as boolean
    };

    /**
     * @description Новая позиция трека в списке
     * @param number - Позиция трека
     * @public
     */
    public set position(number: number) {
        // Переключаем позицию на первый трек
        if (number >= this._tracks._current.length) {
            // Если указана позиция больше чем треков в списке
            this._tracks._position = 0;
            return;
        }

        // Переключаем с первой позиции на последнею позицию
        else if (number < 0) {
            // Меняем позицию на последнюю доступную
            this._tracks._position = this._tracks._current.length - 1;
            return;
        }

        // Меняем позицию
        this._tracks._position = number;
    };

    /**
     * @description Текущая позиция трека в очереди
     * @return number
     * @public
     */
    public get position() {
        return this._tracks._position;
    };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        return this._tracks._current.reduce((total: number, item) => total + (item.time.total || 0), 0).duration();
    };

    /**
     * @description Получаем текущий трек
     * @return Track
     * @public
     */
    public get track() {
        return this._tracks._current[this.position];
    };

    /**
     * @description Перетасовка треков, так-же есть поддержка полного восстановления
     * @public
     */
    public set shuffle(bol: boolean) {
        // Если перетасовка выключена
        if (!this._tracks._shuffle) {
            let currentIndex = this.size;

            // Записываем треки до перетасовки
            this._tracks._original.push(...this._tracks._current);

            // Хотя еще остались элементы, которые нужно перетасовать...
            while (currentIndex != 0) {
                let randomIndex = Math.floor(Math.random() * currentIndex);
                currentIndex--;

                // Текущий трек не трогаем
                if (currentIndex !== this.position && randomIndex !== this.position) {
                    // И замените его текущим элементом.
                    [this._tracks._current[currentIndex], this._tracks._current[randomIndex]] = [this._tracks._current[randomIndex], this._tracks._current[currentIndex]];
                }
            }
        }

        // Восстанавливаем оригинальную очередь
        else {
            // Меняем треки в текущей очереди на оригинальные
            this._tracks._current = this._tracks._original;

            // Удаляем оригинальные треки, поскольку они теперь и основной ветке
            this._tracks._original = [];
        }

        // Меняем переменную
        this._tracks._shuffle = bol;
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean {
        return this._tracks._shuffle;
    };

    /**
     * @description Сохраняем тип повтора
     * @param type - Тип повтора
     * @public
     */
    public set repeat(type) {
        this._tracks._repeat = type;
    };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() {
        return this._tracks._repeat;
    };

    /**
     * @description Кол-во треков в очереди с учетом текущей позиции
     * @return number
     * @public
     */
    public get size() {
        return this._tracks._current.length - this.position;
    };

    /**
     * @description Общее кол-во треков в очереди
     * @return number
     * @public
     */
    public get total() {
        return this._tracks._current.length;
    };


    /**
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     */
    public push = (track: Track) => {
        // Если включена перетасовка, то добавляем треки в оригинальную очередь
        if (this._tracks._shuffle) this._tracks._original.push(track);

        // Добавляем трек в текущую очередь
        this._tracks._current.push(track);
    };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     */
    public remove = (position: number) => {
        // Если трек удаляем из виртуально очереди, то и из оригинальной
        if (this._tracks._shuffle) {
            const index = this._tracks._original.indexOf(this._tracks._current[position]);
            if (index > -1) this._tracks._original.splice(index, 1);
        }

        // Удаляем из очереди
        this._tracks._current.splice(position, 1);

        // Меняем позицию, есть она не равна 0
        if (this._tracks._position !== 0) this._tracks._position = this._tracks._position - 1;
    };

    /**
     * @description Получаем <указанное> кол-во треков
     * @param size - При -5 будут выданы выданные последние до текущего трека, при +5 будут выданы следующие треки
     * @param sorting - При включении треки перейдут в string[]
     */
    public array = (size: number, sorting: boolean = false) => {
        const position = this._tracks._position;

        // Сортируем треки в строки
        if (sorting) {
            let number = 0;

            // Создаем Array
            return this._tracks._current.ArraySort(size, (track) => {
                number++;
                return `\`${number}\` - ${track.name_replace}`;
            }, "\n");
        }

        // Выдаем список треков
        if (size < 0) return this._tracks._current.slice(position - 1 - size, position - 1 - size);
        return this._tracks._current.slice(position + 1, position + size);
    };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     */
    public get = (position: number ) => {
        return this._tracks._current[position];
    };

    /**
     * @description Ищем позицию в базе
     * @param track - Искомый трек
     */
    public indexOf = (track: Track) => {
        return this._tracks._current.indexOf(track);
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

/**
 * @author SNIPPIK
 * @description Данные хранящиеся в классе
 * @interface PlayerTracksData
 * @class PlayerTracks
 * @private
 */
interface PlayerTracksData {
    /**
     * @description Хранилище треков, хранит в себе все треки. Прошлые и новые!
     * @readonly
     * @private
     */
    _current: Track[];

    /**
     * @description Хранилище треков в оригинальном порядке, необходимо для правильной работы shuffle
     * @readonly
     * @private
     */
    _original: Track[];

    /**
     * @description Текущая позиция в списке
     * @private
     */
    _position: number;

    /**
     * @description Тип повтора
     * @private
     */
    _repeat: RepeatType;

    /**
     * @description Смешивание треков
     * @private
     */
    _shuffle: boolean;
}