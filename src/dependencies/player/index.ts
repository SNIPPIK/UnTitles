import type {LocalizationMap} from "discord-api-types/v10";
import {TypedEmitter} from "tiny-typed-emitter";
import {AudioResource} from "@lib/player/audio";
import {VoiceConnection} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Плеер для проигрывания музыки
 * @class AudioPlayer
 * @extends TypedEmitter
 */
export class AudioPlayer extends TypedEmitter<AudioPlayerEvents> {
    private readonly id: string = null;
    private readonly audioFilters = new AudioFilters();
    private readonly data = {
        status: "player/wait"   as keyof AudioPlayerEvents,
        voice:  null            as VoiceConnection,
        stream: null            as AudioResource
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
     * @description Выдаем ID сервера с которым работает плеер или аутентификатор плеера
     * @return string - ID сервера для аутентификации плеера
     * @public
     */
    public get ID() { return this.id; };

    /**
     * @description Управляем фильтрами
     * @return AudioFilters
     * @public
     */
    public get filters() { return this.audioFilters; };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() { return this.data.voice; };

    /**
     * @description Текущий статус плеера
     * @return AudioPlayerStatus
     * @public
     */
    public get status() { return this.data.status; };

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get stream() { return this.data.stream; };

    /**
     * @description Проверяем играет ли плеер
     * @return boolean
     * @public
     */
    public get playing() {
        if (this.status === "player/wait" || !this.connection) return false;

        //Если больше не читается, переходим в состояние wait.
        if (!this.stream?.readable) {
            this.stream?.stream?.emit("end");
            this.status = "player/wait";
            return false;
        }

        return true;
    };

    /**
     * @description Взаимодействие с голосовым подключением
     * @param connection - Голосовое подключение
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (this.data.voice && this.data.voice.config.channelId === connection.config.channelId) return;
        this.data.voice = connection;
    };

    /**
     * @description Смена статуса плеера, если не знаешь что делаешь, то лучше не трогай!
     * @param status - Статус плеера
     * @public
     */
    public set status(status: keyof AudioPlayerEvents) {
        //Если новый статус не является старым
        if (status !== this.data.status) {
            if (status === "player/pause" || status === "player/wait") {
                //this.connection.speak = false;
                this.stream?.stream?.emit("pause");
            } else this.connection.speak = true;

            this.emit(status, this);
        }

        this.data.status = status;
    };

    /**
     * @description Смена потока
     * @param stream - Opus конвертор
     * @public
     */
    public set stream(stream: AudioResource) {
        //Если есть текущий поток
        if (this.stream && this.stream?.stream) {
            this.stream?.stream?.emit("close");
            this.data.stream = null;
        }

        //Подключаем новый поток
        this.data.stream = stream;
        this.status = "player/playing";
    };

    /**
     * @description Передача пакета в голосовой канал
     * @public
     */
    public set sendPacket(packet: Buffer) {
        try {
            if (packet) this.connection.playOpusPacket(packet)
        } catch (err) {
            //Подключаемся к голосовому каналу заново
            if (`${err}`.includes("getaddrinfo")) {
                this.status = "player/pause";
                this.emit("player/error", this, `Attempt to reconnect to the voice channel!`);

                for (let r = 0; r < 2; r++) {
                    if (this.connection.state.status === "ready") break;
                    this.connection.rejoin();
                }
            }

            //Если возникает не исправимая ошибка, то выключаем плеер
            this.emit("player/error", this, `${err}`, "crash");
        }
    };

    /**
     * @description Начинаем чтение стрима
     * @public
     */
    public set read(options: {path: string, seek: number}) {
        const stream = new AudioResource(Object.assign(options, this.filters.compress));

        //Если стрим можно прочитать
        if (stream.readable) {
            this.stream = stream;
            return;
        }

        const timeout = setTimeout(() => {
            this.emit("player/error", this, "Timeout the stream has been exceeded!", "skip");
        }, 25e3);

        stream.stream
            //Включаем поток когда можно будет начать читать
            .once("readable", () => {
                this.stream = stream;
                clearTimeout(timeout);
            })
            //Если происходит ошибка, то продолжаем читать этот же поток
            .once("error", () => {
                this.emit("player/error", this, "Fail read stream", "skip");
                clearTimeout(timeout);
            });
    };

    /**
     * @description Функция отвечает за циклическое проигрывание
     * @param track - Трек который будет включен
     * @param seek - Пропуск времени
     * @public
     */
    public play = (track: AudioPlayerInput, seek: number = 0): void => {
        if (!track || !("resource" in track)) {
            this.emit("player/wait", this);
            return;
        }

        // Получаем ссылку на исходный трек
        track.resource.then((path) => {
            // Если нет ссылки на аудио
            if (!path) {
                this.emit("player/error", this, `Not found link audio!`, "skip");
                return;
            }

            // Если получена ошибка вместо ссылки
            else if (path instanceof Error) {
                this.emit("player/error", this, `Failed to getting link audio!\n\n${path.name}\n- ${path.message}`, "skip");
                return;
            }

            this.emit("player/ended", this, seek);
            this.read = {path, seek};
        }).catch((err) => {
            this.emit("player/error", this, `${err}`, "skip");
            //Logger.log("ERROR", err);
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
     * @description Удаляем ненужные данные
     * @public
     */
    public cleanup = () => {
        this.removeAllListeners();
        //Выключаем плеер если сейчас играет трек
        this.stop();

        try {
            this.stream?.stream?.emit("end");
        } catch (err) {
            console.error(err)
        }

        for (let str of Object.keys(this.data)) this.data[str] = null;
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    //Плеер начал играть новый трек
    "player/ended": (player: AudioPlayer, seek: number) => void;

    //Плеер закончил играть трек
    "player/wait": (player: AudioPlayer) => void;

    //Плеер встал на паузу
    "player/pause": (player: AudioPlayer) => void;

    //Плеер играет
    "player/playing": (player: AudioPlayer) => void;

    //Плеер получил ошибку
    "player/error": (player: AudioPlayer, err: string, type?: "crash" | "skip") => void;
}

/**
 * @author SNIPPIK
 * @description Данные входящие в качестве трека
 * @interface AudioPlayerInput
 * @private
 */
interface AudioPlayerInput {
    resource: Promise<string | Error>
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