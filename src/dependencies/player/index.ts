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
    private _stream: AudioResource = null;

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get current() { return this._stream; };

    /**
     * @description Подключаем новый поток
     * @param stream
     */
    public set current(stream) {
        // Если есть текущий поток
        if (this.current) {
            this.current?.stream?.emit("close");
            this.current.destroy();
            this._stream = null;
        }

        // Подключаем новый поток
        this._stream = stream;
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
    private _voice: VoiceConnection = null;

    /**
     * @description Производим подключение к голосовому каналу
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (connection?.config) {
            // Если боту нельзя говорить, то смысл продолжать
            if (connection.config.selfMute) return;

            // Если повторное подключение к тому же голосовому каналу
            else if (this._voice && connection.config.channelId === this._voice.config.channelId) {
                connection.configureSocket();
            }
        }

        this._voice = connection;
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this._voice; };

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
     * @description Хранилище треков, хранит в себе все треки. Прошлые и новые!
     * @readonly
     * @private
     */
    private readonly _tracks: Track[] = [];

    /**
     * @description Текущая позиция в списке
     * @private
     */
    private _position = 0;

    /**
     * @description На сколько сделать пропуск треков
     * @param number - Позиция трека
     * @public
     */
    public set swapPosition(number: number) { this._position = number; };

    /**
     * @description Текущая позиция трека в очереди
     * @return number
     * @public
     */
    public get position() { return this._position; };


    /**
     * @description Кол-во треков в очереди с учетом текущей позиции
     * @return number
     * @public
     */
    public get size() { return this._tracks.length - this.position; };

    /**
     * @description Кол-во треков в очереди
     * @return number
     * @public
     */
    public get total() { return this._tracks.length; };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        const tracks = this._tracks.slice(this._position);
        const total = tracks.reduce((total: number, item: {time: { total: number }}) => total + (item.time.total || 0), 0);

        return total.duration();
    };


    /**
     * @description Получаем текущий трек
     * @return Song
     * @public
     */
    public get track() { return this._tracks[this._position]; };


    /**
     * @description Получаем последние n треков, не включает текущий
     * @param size - Кол-во треков
     * @public
     */
    public last = (size: number = 5) => {
        return this._tracks.slice(this._position - 1 - size, this._position - 1 - size);
    };

    /**
     * @description Получаем следующие n треков, не включает текущий
     * @param size - Кол-во треков
     * @public
     */
    public next = (size: number = 5) => {
        return this._tracks.slice(this._position + 1, this._position + size);
    };

    /**
     * @description Сортируем все треки в Array<Array, Array>
     * @param size - Кол-во треков в одном списке
     */
    public arraySort = (size: number = 5) => {
        let number = 0;

        // Создаем Array
        return this._tracks.ArraySort(size, (track) => {
            number++;
            return `\`${number}\` - ${track.titleReplaced}`;
        }, "\n");
    };


    /**
     * @description Перетасовка треков без нарушения текущий позиции
     * @public
     */
    public shuffle = () => {
        const i = this.size.random(1);

        // Меняем трек текущий позиции на случайный
        [this._tracks[this._position], this._tracks[i]] = [this._tracks[i], this._tracks[this._position]];
    };


    /**
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     */
    public push = (track: Track) => { this._tracks.push(track); };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     */
    public get = (position: number) => { return this._tracks[position]; };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     */
    public remove = (position: number) => {
        // Удаляем из очереди
        this._tracks.splice(position, 1);
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
     */
    public readonly bar = (options: {duration: {current: number; total: number}, platform: string}) => {
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
    private readonly enables: AudioFilter[] = [];

    /**
     * @description Получаем список включенных фильтров
     * @public
     */
    public get enable() { return this.enables; };

    /**
     * @description Сжимаем фильтры для работы ffmpeg
     */
    public get compress() {
        const realFilters: string[] = [`volume=${db.audio.options.volume / 100}`, `afade=t=in:st=0:d=${db.audio.options.fade}`];
        let chunk = 0;

        // Берем данные из всех фильтров
        for (const filter of this.enable) {
            const filterString = filter.args ? `${filter.filter}${filter.user_arg ?? ""}` : filter.filter;
            realFilters.push(filterString);

            // Если есть модификация скорости, то изменяем размер пакета
            if (filter.speed) {
                if (typeof filter.speed === "number") chunk += Number(filter.speed);
                else chunk += Number(this.enable.slice(this.enable.indexOf(filter) + 1));
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
     * @public
     */
    public readonly id: string = null;

    /**
     * @description Подключаем класс для отображения прогресс бара
     * @private
     */
    private readonly _progress: PlayerProgress = new PlayerProgress(12);

    /**
     * @description Хранилище треков
     * @private
     */
    private readonly _tracks: PlayerTracks = new PlayerTracks();

    /**
     * @description Хранилище аудио фильтров
     * @private
     */
    private readonly _filters: PlayerAudioFilters = new PlayerAudioFilters();

    /**
     * @description Управление голосовыми состояниями
     * @private
     */
    private readonly _voice: PlayerVoice = new PlayerVoice();

    /**
     * @description Управление потоковым вещанием
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

            // Запускаем ивент
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

        // Загружаем ивенты плеера
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

                    // Подключаем ивенты для отслеживания работы потока (временные)
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
    public stop = (): void => {
        if (this.status === "player/wait") return;
        this.status = "player/wait";
    };

    /**
     * @description Работает по принципу stop, но с плавным переходом
     * @param position - номер трека
     */
    public stop_fade = (position: number) => {
        const old = this.tracks.position;

        // Меняем позицию трека в очереди
        if (this.audio.current.duration < this.tracks.track.time.total + db.audio.options.optimization) {
            this.tracks.swapPosition = position;
            this.play();

            // Если не получилось начать чтение следующего трека
            this.audio.current.stream.once("error", () => {
                // Возвращаем прошлый номер трека
                this.tracks.swapPosition = old;
            });
        } else {
            // Если надо вернуть прошлый трек, но времени уже нет!
            if (this.tracks.position > position) this.tracks.swapPosition = position - 1;
            this.stop();
        }
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
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
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    //Плеер начал играть новый трек
    "player/ended": (player: ExtraPlayer, seek: number) => void;

    //Плеер закончил играть трек
    "player/wait": (player: ExtraPlayer) => void;

    //Плеер встал на паузу
    "player/pause": (player: ExtraPlayer) => void;

    //Плеер играет
    "player/playing": (player: ExtraPlayer) => void;

    //Плеер получил ошибку
    "player/error": (player: ExtraPlayer, err: string, critical?: boolean) => void;
}