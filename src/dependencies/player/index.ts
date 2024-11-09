import type {LocalizationMap} from "discord-api-types/v10";
import {TypedEmitter} from "tiny-typed-emitter";
import {AudioResource} from "@lib/player/audio";
import {VoiceConnection} from "@lib/voice";
import {Track} from "@lib/player/queue";
import {Logger} from "@lib/logger";
import {API} from "@handler";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки на серверах
 * @class ExtraPlayer
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
     * @description Хранилище треков
     * @private
     */
    private readonly _tracks = new PlayerSongs();

    /**
     * @description Хранилище аудио фильтров
     * @private
     */
    private readonly _filters = new AudioFilters();

    /**
     * @description Управление голосовыми состояниями
     * @private
     */
    private readonly _voice = new PlayerVoice();

    /**
     * @description Управление потоковым вещанием
     * @private
     */
    private readonly _audio = new PlayerStreamSubSystem();

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
     * @description Строка состояния трека
     * @public
     */
    public get progress() {
        const {platform, time} = this.tracks.song;

        // Создаем прогресс бар
        return new PlayerProgress({
            platform: platform,
            duration: {
                total: time.total,
                current: this.audio?.current?.duration ?? 0
            }
        });
    };



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
     * @description Функция отвечает за циклическое проигрывание
     * @param track - Трек который будет включен
     * @param seek  - Пропуск времени
     * @public
     */
    public play = (track: PlayerInput, seek: number = 0): void => {
        // Если больше нет треков
        if (!track?.resource) {
            this.emit("player/error", this, `Playing is ending`, false);
            this.emit("player/wait", this);
            return;
        }

        // Получаем асинхронные данные в синхронном потоке
        track.resource
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
                    // Создаем сообщение о текущем треке
                    this.emit("player/ended", this, seek);
                }
            )
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
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        this.removeAllListeners();
        // Выключаем плеер если сейчас играет трек
        this.stop();

        // Вырубаем поток, если он есть
        if (this.audio.current) {
            this.audio.current.stream.emit("close");
            this.audio.current.destroy();
        }
    };
}

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком
 * @class PlayerStreamSubSystem
 */
class PlayerStreamSubSystem {
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
 * @description Класс для управления голосовыми подключениями
 * @class PlayerVoice
 */
class PlayerVoice {
    private voice = null as VoiceConnection;

    /**
     * @description Производим подключение к голосовому каналу
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (connection?.config) {
            // Если боту нельзя говорить, то смысл продолжать
            if (connection.config.selfMute) return;

            // Если повторное подключение к тому же голосовому каналу
            else if (this.voice && connection.config.channelId === this.voice.config.channelId) {
                connection.configureSocket();
            }
        }

        this.voice = connection;
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this.voice; };

    /**
     * @description Отправляем пакет в голосовой канал
     * @public
     */
    public set send(packet: Buffer) {
        if (!packet) return;

        // Отправляем пакет в голосовой канал
        try {
            if (packet) this.connection.playOpusPacket(packet);
        } catch (err) {
            if (`${err}`.match(/UDP port on your IP/)) {
                // Реконфигурация сокета, переподключение!
                setTimeout(() => {
                    this.voice.configureSocket();
                }, 5e3);
            }

            // Если возникает ошибка, то сообщаем о ней
            console.log(err);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Все треки для проигрывания в плеере
 * @class PlayerSongs
 */
class PlayerSongs {
    private readonly _songs: Track[] = [];
    private _position = 0;

    /**
     * @description На сколько сделать пропуск треков
     * @param number - Позиция трека
     * @public
     */
    public set swapPosition(number: number) {
        this._position = number;
    };

    /**
     * @description Получаем текущий трек
     * @return Song
     * @public
     */
    public get song() { return this._songs[this._position]; };

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
    public get size() { return this._songs.length - this.position; };

    /**
     * @description Кол-во треков в очереди
     * @return number
     * @public
     */
    public get total() { return this._songs.length; };

    /**
     * @description Общее время треков
     * @public
     */
    public get time() {
        return this._songs.slice(this._position).reduce((total: number, item: {time: { total: number }}) => total + (item.time.total || 0), 0).duration();
    };

    /**
     * @description Добавляем трек в очередь
     * @param track - Сам трек
     */
    public push = (track: Track) => { this._songs.push(track); };

    /**
     * @description Получаем прошлый трек или текущий в зависимости от позиции
     * @param position - позиция трека, номер в очереди
     */
    public get = (position: number) => {
        // Если позиция трека больше чем всего треков или меньше
        //if (position > this.total || position < this.total) return;

        return this._songs[position];
    };

    /**
     * @description Получаем следующие n треков, не включает текущий
     * @param length - Кол-во треков
     * @public
     */
    public next = (length: number = 5) => {
        return this._songs.slice(this._position + 1, this._position + length);
    };

    /**
     * @description Удаляем из очереди неугодный трек
     * @param position - позиция трека, номер в очереди
     */
    public remove = (position: number) => {
        // Если позиция трека больше чем всего треков или меньше
        //if (position > this.total || position < this.total) return;

        // Удаляем из очереди
        this._songs.splice(position, 1);
    };

    /**
     * @description Получаем последние n треков, не включает текущий
     * @param length - Кол-во треков
     * @public
     */
    public last = (length: number = 5) => {
        return this._songs.slice(this._position - 1 - length, this._position - 1 - length);
    };

    /**
     * @description Перетасовка треков
     * @public
     * @dev Надо переработать
     */
    public shuffle = () => {
        for (let i = this.size - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [this._songs[i], this._songs[j]] = [this._songs[j], this._songs[i]];
        }
    };
}

/**
 * @author SNIPPIK
 * @description Обработчик прогресс бара трека
 * @class PlayerProgress
 */
class PlayerProgress {
    private static emoji: typeof db.emojis.progress = null;
    private readonly size = 12;
    private readonly options = {
        platform: null as API.platform,
        duration: {
            current: 0 as number,
            total: 0 as number
        }
    };

    /**
     * @description Получаем время плеера и текущее, для дальнейшего создания прогресс бара
     * @private
     */
    private get duration() { return this.options.duration; };

    /**
     * @description Получаем эмодзи для правильного отображения
     * @private
     */
    private get emoji() {
        if (!PlayerProgress.emoji) PlayerProgress.emoji = db.emojis.progress;
        return PlayerProgress.emoji;
    };

    /**
     * @description Получаем название платформы
     * @private
     */
    private get platform() { return this.options.platform; };

    /**
     * @description Получаем эмодзи кнопки
     * @private
     */
    private get bottom() { return this.emoji["bottom_" + this.platform] || this.emoji.bottom; };

    /**
     * @description Получаем готовый прогресс бар
     */
    public get bar() {
        const size =  this.size, {current, total} = this.duration, emoji = this.emoji;
        const number = Math.round(size * (isNaN(current) ? 0 : current / total));
        let txt = current > 0 ? `${emoji.upped.left}` : `${emoji.empty.left}`;

        //Середина дорожки + точка
        if (current === 0) txt += `${emoji.upped.center.repeat(number)}${emoji.empty.center.repeat((size + 1) - number)}`;
        else if (current >= total) txt += `${emoji.upped.center.repeat(size)}`;
        else txt += `${emoji.upped.center.repeat(number)}${this.bottom}${emoji.empty.center.repeat(size - number)}`;

        return txt + (current >= total ? `${emoji.upped.right}` : `${emoji.empty.right}`);
    };

    /**
     * @description Создаем класс
     * @param options - Параметры класса
     */
    public constructor(options: PlayerProgress["options"]) {
        Object.assign(this.options, options);
        this.options.platform = options.platform.toLowerCase() as any;
    };
}

/**
 * @author SNIPPIK
 * @description Данные входящие в качестве трека
 * @interface PlayerInput
 * @private
 */
interface PlayerInput {
    resource: Promise<string | Error>
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

/**
 * @author SNIPPIK
 * @description Управление фильтрами
 */
export class AudioFilters {
    /**
     * @description Включенные фильтры
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
 * @description Как выглядит фильтр
 * @interface AudioFilter
 */
export interface AudioFilter {
    //Имена
    name: string;

    //Имена несовместимых фильтров
    unsupported: string[];

    //Описание
    description: string;

    //Перевод фильтров
    description_localizations: LocalizationMap;

    //Сам фильтр
    filter: string;

    //Аргументы
    args: false | [number, number];

    //Аргумент пользователя
    user_arg?: any;

    //Меняется ли скорость
    speed?: string | number;
}