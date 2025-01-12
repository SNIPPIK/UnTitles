import type {LocalizationMap} from "discord-api-types/v10";
import {AudioResource} from "@lib/voice/audio/Opus";
import {TypedEmitter} from "tiny-typed-emitter";
import {VoiceConnection} from "@lib/voice";
import {Track} from "@lib/player/track";
import {Logger} from "@lib/logger";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком, хранит в себе все данные потока
 * @class PlayerStream
 * @protected
 */
class PlayerStream {
    /**
     * @description Поток, расшифровывает ogg/opus в чистый opus он же sl16e
     * @private
     */
    private _audio: AudioResource = null;

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get current() { return this._audio; };

    /**
     * @description Подключаем новый поток
     * @param stream
     */
    public set current(stream) {
        // Если есть текущий поток
        if (this.current) {
            this.current?.stream?.emit("close");
            this.current.destroy();
            this._audio = null;
        }

        // Подключаем новый поток
        this._audio = stream;
    };
}

/**
 * @author SNIPPIK
 * @description Класс для управления голосовыми подключениями, хранит в себе все данные голосового подключения
 * @class PlayerVoice
 * @protected
 */
class PlayerVoice {
    /**
     * @description Текущее голосовое подключение к каналу на сервере
     * @private
     */
    private _connection: VoiceConnection = null;

    /**
     * @description Производим подключение к голосовому каналу
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (connection?.config) {
            // Если боту нельзя говорить, то смысл продолжать
            if (connection.config.selfMute) return;

            // Если повторное подключение к тому же голосовому каналу
            else if (this._connection && connection.config.channelId === this._connection.config.channelId) {
                connection.configureSocket();
            }
        }

        this._connection = connection;
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this._connection; };

    /**
     * @description Отправляем пакет в голосовой канал
     * @public
     */
    public set send(packet: Buffer) {
        if (!packet) return;

        // Отправляем пакет в голосовой канал
        try {
            if (packet) this.connection.packet(packet);
        } catch (err) {
            // Если возникает ошибка, то сообщаем о ней
            console.log(err);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Все треки для проигрывания в плеере, хранит в себе все данные треков
 * @class PlayerTracks
 * @protected
 */
class PlayerTracks {
    /**
     * @description База данных для работы с треками
     * @private
     */
    private readonly _tracks = {
        /**
         * @description Хранилище треков, хранит в себе все треки. Прошлые и новые!
         * @readonly
         * @private
         */
        _current:  [] as Track[],

        /**
         * @description Хранилище треков в оригинальном порядке, необходимо для правильной работы shuffle
         * @readonly
         * @private
         */
        _original: [] as Track[],

        /**
         * @description Текущая позиция в списке
         * @private
         */
        _position: 0,

        /**
         * @description Тип повтора
         * @private
         */
        _repeat: "off" as "off" | "song" | "songs",

        /**
         * @description Смешивание треков
         * @private
         */
        _shuffle: false as boolean
    }

    /**
     * @description На сколько сделать пропуск треков
     * @param number - Позиция трека
     * @public
     */
    public set position(number: number) { this._tracks._position = number; };

    /**
     * @description Текущая позиция трека в очереди
     * @return number
     * @public
     */
    public get position() { return this._tracks._position; };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        const tracks = this._tracks._current.slice(this.position);
        const total = tracks.reduce((total: number, item) => total + (item.time.total || 0), 0);

        return total.duration();
    };

    /**
     * @description Получаем текущий трек
     * @return Track
     * @public
     */
    public get track() { return this._tracks._current[this.position]; };

    /**
     * @description Перетасовка треков, так-же есть поддержка полного восстановления
     * @public
     */
    public set shuffle(bol: boolean) {
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

            setTimeout(() => {
                // Удаляем оригинальные треки, поскольку они теперь и основной ветке
                this._tracks._original = [];
            }, 2e3);
        }

        // Меняем переменную
        this._tracks._shuffle = bol;
    };

    /**
     * @description Получаем данные перетасовки
     * @public
     */
    public get shuffle(): boolean { return this._tracks._shuffle; };

    /**
     * @description Сохраняем тип повтора
     * @param type - Тип повтора
     * @public
     */
    public set repeat(type: "off" | "song" | "songs") { this._tracks._repeat = type; };

    /**
     * @description Получаем тип повтора
     * @public
     */
    public get repeat() { return this._tracks._repeat; };

    /**
     * @description Кол-во треков в очереди с учетом текущей позиции
     * @return number
     * @public
     */
    public get size() { return this._tracks._current.length - this.position; };

    /**
     * @description Общее кол-во треков в очереди
     * @return number
     * @public
     */
    public get total() { return this._tracks._current.length; };


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
                return `\`${number}\` - ${track.titleReplaced}`;
            }, "\n");
        }

        // Выдаем список треков
        if (size < 0) return this._tracks._current.slice(position - 1 - size, position - 1 - size);
        return this._tracks._current.slice(position + 1, position + size);
    };

    /**
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     */
    public push = (track: Track): void => {
        // Если включена перетасовка, то добавляем треки в оригинальную очередь
        if (this._tracks._shuffle) this._tracks._original.push(track);

        // Добавляем трек в текущую очередь
        this._tracks._current.push(track);
    };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     */
    public get = (position: number) => { return this._tracks[position]; };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     */
    public remove = (position: number): void => {
        // Если трек удаляем из виртуально очереди, то и из оригинальной
        if (this._tracks._shuffle) {
            const index = this._tracks._original.indexOf(this._tracks._current[position]);
            if (index > -1) this._tracks._original.splice(index, 1);
        }

        // Удаляем из очереди
        this._tracks._current.splice(position, 1);
    };

    /**
     * @description Функция для переключения трека на следующий, сопоставление аргументов и прочее
     * @public
     */
    public autoPosition = (): void => {
        const repeat = this.repeat, position = this.position;

        // Проверяем надо ли удалить из очереди трек
        if (repeat === "off" || repeat === "songs") {
            // Смена трек на следующий
            this.position = position + 1;

            // Если включен повтор и нет больше треков, значит включаем обратно все треки
            if (repeat === "songs" && position >= this.total) this.position = 0;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class PlayerProgress
 * @protected
 */
class PlayerProgress {
    /**
     * @description Размер прогресс бара
     * @readonly
     * @private
     */
    private readonly size: number = null;

    /**
     * @description Эмодзи в качестве дизайнерского решения
     * @readonly
     * @static
     * @private
     */
    private static emoji: typeof db.emojis.progress = null;

    /**
     * @description Создаем класс для отображения прогресс бара
     * @param size - Размер
     */
    public constructor(size: number = 12) {
        if (!PlayerProgress.emoji) PlayerProgress.emoji = db.emojis.progress;
        this.size = size;
    };

    /**
     * @description Получаем готовый прогресс бар
     * @readonly
     * @public
     */
    public readonly bar = (options: {duration: {current: number; total: number}, platform: string}): string => {
        const emoji = PlayerProgress.emoji;
        const button = emoji["bottom_" + options.platform.toLowerCase()] || emoji.bottom;
        const {current, total} = options.duration;
        const size = this.size;

        const number = Math.round(size * (isNaN(current) ? 0 : current / total));
        let txt = current > 0 ? `${emoji.upped.left}` : `${emoji.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) txt += `${emoji.upped.center.repeat(number)}${emoji.empty.center.repeat((size + 1) - number)}`;
        else if (current >= total) txt += `${emoji.upped.center.repeat(size)}`;
        else txt += `${emoji.upped.center.repeat(number)}${button}${emoji.empty.center.repeat(size - number)}`;

        return txt + (current >= total ? `${emoji.upped.right}` : `${emoji.empty.right}`);
    };
}

/**
 * @author SNIPPIK
 * @description Управление фильтрами, хранит и конвертирует в string для FFmpeg
 * @class PlayerAudioFilters
 * @public
 */
class PlayerAudioFilters {
    /**
     * @description Включенные фильтры
     * @readonly
     * @private
     */
    private readonly _filters: AudioFilter[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enabled() { return this._filters; };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     */
    public get compress() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`, `afade=t=in:st=0:d=${db.audio.options.fade}`];
        let chunk = 0;

        // Берем данные из всех фильтров
        for (const filter of this.enabled) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            // Если есть модификация скорости, то изменяем размер пакета
            if (filter.speed) {
                if (typeof filter.speed === "number") chunk += Number(filter.speed);
                else chunk += Number(this.enabled.slice(this.enabled.indexOf(filter) + 1));
            }
        }

        return { filters: realFilters.join(","), chunk };
    };
}


/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки на серверах
 * @class ExtraPlayer
 * @public
 */
export class ExtraPlayer extends TypedEmitter<AudioPlayerEvents> {
    /**
     * @description Текущий статус плеера, при создании он должен быть в ожидании
     * @private
     */
    private _status: keyof AudioPlayerEvents = "player/wait";

    /**
     * @description Плеер привязан к queue, и это его идентификатор
     * @readonly
     * @public
     */
    public readonly id: string = null;

    /**
     * @description Подключаем класс для отображения прогресс бара
     * @readonly
     * @private
     */
    private readonly _progress: PlayerProgress = new PlayerProgress(12);

    /**
     * @description Хранилище треков
     * @readonly
     * @private
     */
    private readonly _tracks: PlayerTracks = new PlayerTracks();

    /**
     * @description Хранилище аудио фильтров
     * @readonly
     * @private
     */
    private readonly _filters: PlayerAudioFilters = new PlayerAudioFilters();

    /**
     * @description Управление голосовыми состояниями
     * @readonly
     * @private
     */
    private readonly _voice: PlayerVoice = new PlayerVoice();

    /**
     * @description Управление потоковым вещанием
     * @readonly
     * @private
     */
    private readonly _audio: PlayerStream = new PlayerStream();

    /**
     * @description Делаем voice параметр публичным для использования вне класса
     * @public
     */
    public get voice() { return this._voice; };

    /**
     * @description Делаем stream параметр публичным для использования вне класса
     * @public
     */
    public get audio() { return this._audio; };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        if (this.status === "player/wait" || !this.voice.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.audio.current?.readable) {
            this.audio.current?.stream?.emit("end");
            this.status = "player/wait";
            return false;
        }

        return true;
    };



    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this._status; };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @public
     */
    public set status(status: keyof AudioPlayerEvents) {
        // Если был введен новый статус
        if (status !== this.status) {
            // Если начато воспроизведение, то даем возможность говорить боту
            if (status === "player/playing") this.voice.connection.speak = true;

            // Запускаем событие
            this.emit(status, this);
        }

        // Записываем статус
        this._status = status;
    };

    /**
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const {platform, time} = this.tracks.track;
        let current = this.audio?.current?.duration;

        // Скорее всего трек играет следующий трек
        if (current > time.total || !this.playing) current = 0;

        // Создаем прогресс бар
        const bar =  this._progress.bar({ platform, duration: { current, total: time.total } });

        return `\n\`\`${current.duration()}\`\` ${bar} \`\`${time.split}\`\``;
    };



    /**
     * @description Делаем tracks параметр публичным для использования вне класса
     * @public
     */
    public get tracks() { return this._tracks; };

    /**
     * @description Делаем filters параметр публичным для использования вне класса
     * @public
     */
    public get filters() { return this._filters; };



    /**
     * @description Задаем параметры плеера перед началом работы
     * @param guild - ID сервера для аутентификации плеера
     */
    public constructor(guild: string) {
        super();
        this.id = guild;

        // Загружаем события плеера
        for (const event of db.audio.queue.events.player)
            this.on(event, (...args: any[]) => db.audio.queue.events.emit(event as any, ...args));

        // Добавляем плеер в базу для отправки пакетов
        db.audio.cycles.players.set(this);
    };

    /**
     * @description Функция отвечает за циклическое проигрывание, если хотим воспроизвести следующий трек надо избавится от текущего
     * @param seek  - Время трека для пропуска аудио дорожки
     * @public
     */
    public play = (seek: number = 0): void => {
        const track = this._tracks?.track;

        // Если больше нет треков
        if (!track) {
            this.emit("player/wait", this);
            return;
        }

        // Получаем асинхронные данные в синхронном потоке
        track?.resource
            // Если возникла ошибка
            .catch((err) => {
                    // Сообщаем об ошибке
                    Logger.log("ERROR", `[Player]: ${err}`);

                    // Если сейчас не играет трек, то предпринимаем решение
                    if (this.status === "player/wait") this.emit("player/error", this, `${err}`, false);
                }
            )

            // Если удалось получить исходный файл трека
            .then((path) => {
                    // Если нет исходника
                    if (!path) {
                        if (this.status === "player/wait") {
                            this.emit("player/error", this, `Not found link audio!`, false);
                        }

                        return;
                    }

                    // Если получена ошибка вместо исходника
                    else if (path instanceof Error) {
                        if (this.status === "player/wait") {
                            this.emit("player/error", this, `Failed to getting link audio!\n\n${path.name}\n- ${path.message}`, false);
                        }

                        return;
                    }

                    // Создаем класс для управления потоком
                    const stream = new AudioResource({path, seek, ...this._filters.compress});
                    let timeout: NodeJS.Timeout = null;

                    // Если стрим можно прочитать
                    if (stream.readable) {
                        this.audio.current = stream;
                        this.status = "player/playing"

                        return;
                    }

                    // Если поток нельзя читать, возможно что он еще грузится
                    else if (this.status === "player/wait") {
                        timeout = setTimeout(() => {
                            this.emit("player/error", this, "Timeout the stream has been exceeded!", false);

                            // Уничтожаем поток
                            stream.destroy();
                        }, 25e3);
                    }

                    // Подключаем события для отслеживания работы потока (временные)
                    stream.stream
                        // Если возникнет ошибка во время загрузки потока
                        .once("error", () => {
                            clearTimeout(timeout);

                            // Уничтожаем поток
                            stream.destroy();
                        })
                        // Если уже можно читать поток
                        .once("readable", () => {
                            clearTimeout(timeout);

                            this.audio.current = stream;
                            this.status = "player/playing"
                        })
                }
            )

            // Создаем сообщение после всех действий
            .finally(() => {
                this.emit("player/ended", this, seek);
            });
    };

    /**
     * @description Ставим на паузу плеер
     * @public
     */
    public pause = (): void => {
        if (this.status !== "player/playing") return;
        this.status = "player/pause";
    };

    /**
     * @description Убираем с паузы плеер
     * @public
     */
    public resume = (): void => {
        if (this.status !== "player/pause") return;
        this.status = "player/playing";
    };

    /**
     * @description Останавливаем воспроизведение текущего трека
     * @public
     */
    public stop = (position?: number): void => {
        // Работает по принципу stop, но с плавным переходом
        if (position) {
            const old = this.tracks.position;

            // Меняем позицию трека в очереди с учетом времени
            if (this.audio.current.duration < this.tracks.track.time.total + db.audio.options.optimization) {
                this.tracks.position = position;
                this.play();

                // Если не получилось начать чтение следующего трека
                this.audio.current.stream.once("error", () => {
                    // Возвращаем прошлый номер трека
                    this.tracks.position = old;
                });
            } else {
                // Если надо вернуть прошлый трек, но времени уже нет!
                if (this.tracks.position > position) this.tracks.position = position - 1;
                if (this.status === "player/wait") return;
                this.status = "player/wait";
            }
            return;
        }

        if (this.status === "player/wait") return;
        this.status = "player/wait";
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = (): void => {
        this.removeAllListeners();
        // Выключаем плеер если сейчас играет трек
        this.stop();

        // Удаляем текущий поток, поскольку он больше не нужен
        setImmediate(() => {
            // Вырубаем поток, если он есть
            if (this.audio.current) {
                this.audio.current.stream.emit("close");
                this.audio.current.destroy();
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Как выглядит фильтр
 * @interface AudioFilter
 * @public
 */
export interface AudioFilter {
    /**
     * @description Имя фильтра
     * @readonly
     */
    readonly name: string;

    /**
     * @description Имена переводов
     * @readonly
     */
    readonly locale: LocalizationMap;

    /**
     * @description Имена несовместимых фильтров
     * @readonly
     */
    readonly unsupported: string[];

    /**
     * @description Параметр фильтра для ffmpeg
     * @readonly
     */
    readonly filter: string;

    /**
     * @description Аргументы для фильтра
     * @readonly
     */
    readonly args: false | [number, number];

    /**
     * @description Аргументы указанные пользователем
     * @readonly
     */
    user_arg?: any;

    /**
     * @description Модификатор скорости
     * @readonly
     */
    readonly speed?: string | number;
}

/**
 * @author SNIPPIK
 * @description События плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    /**
     * @description Событие при котором плеер начинает завершение текущего трека
     * @param player - Текущий плеер
     * @param seek   - Время пропуска если оно есть
     */
    "player/ended": (player: ExtraPlayer, seek: number) => void;

    /**
     * @description Событие при котором плеер ожидает новый трек
     * @param player - Текущий плеер
     */
    "player/wait": (player: ExtraPlayer) => void;

    /**
     * @description Событие при котором плеер встает на паузу и ожидает дальнейших действий
     * @param player - Текущий плеер
     */
    "player/pause": (player: ExtraPlayer) => void;

    /**
     * @description Событие при котором плеер начинает проигрывание
     * @param player - Текущий плеер
     */
    "player/playing": (player: ExtraPlayer) => void;

    /**
     * @description Событие при котором плеер получает ошибку
     * @param player - Текущий плеер
     * @param err    - Ошибка в формате string
     * @param critical - Если ошибка критична, то плеер будет уничтожен
     */
    "player/error": (player: ExtraPlayer, err: string, critical?: boolean) => void;
}