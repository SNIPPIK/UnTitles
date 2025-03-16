import {Colors, EmbedData} from "discord.js";
import path from "node:path";
import fs from "node:fs";

// @service modules
import {DiscordGatewayAdapterCreator, VoiceConnection, Process, VoiceConnectionStatus} from "@service/voice";
import {Queue, Track, AudioCycles, RepeatType} from "@service/player";
import {locale} from "@service/locale";

// @handler modules
import {API_requester} from "@handler/apis";
import {Commands} from "@handler/commands";
import {Events} from "@handler/events";
import {env} from "@handler";

// Other modules
import {ButtonCallback, SupportButtons} from "@type/discord";
import {Collection, Cycle, Logger} from "@utils";
import {Interact} from "@utils";
import {db} from "@app";


/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
export class Database {
    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения запросов на платформы
     * @readonly
     * @public
     */
    public readonly api = new API_requester();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения событий
     * @readonly
     * @public
     */
    public readonly events = new Events();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
     * @readonly
     * @public
     */
    public readonly queues = new class Database_Queues extends Collection<Queue> {
        /**
         * @description Хранилище циклов для работы музыки
         * @readonly
         * @public
         */
        public readonly cycles = new AudioCycles();

        /**
         * @description Здесь хранятся модификаторы аудио
         * @readonly
         * @public
         */
        public readonly options = {
            optimization: parseInt(env.get("duration.optimization")),
            volume: parseInt(env.get("audio.volume")),
            fade: parseInt(env.get("audio.fade"))
        };

        /**
         * @description Ультимативная функция, позволяет как добавлять треки так и создавать очередь или переподключить очередь к системе
         * @param message - Сообщение пользователя
         * @param item    - Добавляемый объект (необязательно)
         * @public
         */
        public create = (message: Interact, item?: Track.playlist | Track) => {
            let queue = this.get(message.guild.id);

            // Проверяем есть ли очередь в списке, если нет то создаем
            if (!queue) queue = new Queue(message);
            else {
                // Значит что плеера нет в циклах
                if (!this.cycles.players.match(queue.player)) {
                    const voice = db.voice.get(message.guild.id);

                    // Если нет голосового подключения
                    if (!voice) queue.voice = message.voice;

                    // Если это новый текстовый канал
                    if (queue.message.channel.id !== message.channel.id) queue.message = message;

                    // Добавляем плеер в базу цикла для отправки пакетов
                    this.cycles.players.set(queue.player);

                    // Если плеер не запустится сам
                    setImmediate(() => {
                        // Если добавлен трек
                        if (item instanceof Track) queue.player.tracks.position = queue.player.tracks.total - 1;

                        // Если очередь перезапущена
                        else if (!item) queue.player.tracks.position = 0;

                        // Если добавлен плейлист
                        else queue.player.tracks.position = queue.player.tracks.total - item.items.length

                        // Запускаем проигрывание
                        setTimeout(queue.player.play, 400);
                    });
                }
            }

            // Если надо перезапустить очередь
            if (item) {
                // Отправляем сообщение о том что было добавлено
                if ("items" in item || item instanceof Track && queue.tracks.total > 0) {
                    db.events.emitter.emit("message/push", message, item);
                }

                // Добавляем треки в очередь
                for (const track of (item["items"] ?? [item]) as Track[]) {
                    track.user = message.author;
                    queue.tracks.push(track);
                }
            }
        };
    };

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения голосовых подключений
     * @readonly
     * @public
     */
    public readonly voice = new class Database_voices extends Collection<VoiceConnection> {
        /**
         * @description Подключение к голосовому каналу
         * @param config - Данные для подключения
         * @param adapterCreator - Для отправки пакетов
         * @public
         */
        public join = (config: VoiceConnection["config"], adapterCreator: DiscordGatewayAdapterCreator) => {
            let connection = this.get(config.guild_id);

            // Если есть голосовое подключение при подключении
            if (connection) {
                // Удаляем голосовое подключение
                this.remove(connection.config.guild_id);
                connection = null;
            }

            // Если нет голосового подключения, то создаем и сохраняем в базу
            if (!connection) {
                connection = new VoiceConnection(config, adapterCreator);
                this.set(config.guild_id, connection);
            }

            // Если есть голосовое подключение, то подключаемся заново
            if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
                if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin(config);
                else if (!connection.state.adapter.sendPayload(connection.payload(config))) {
                    connection.state = { ...connection.state,
                        status: VoiceConnectionStatus.Disconnected,
                        reason: 1
                    };
                }
            }

            return connection;
        };
    };

    /**
     * @author SNIPPIK
     * @description Класс для кеширования аудио и данных о треках
     * @readonly
     * @public
     */
    public readonly cache = new class CacheUtility {
        /**
         * @description Параметры утилиты кеширования
         * @readonly
         * @private
         */
        private readonly _options = {
            /**
             * @description Путь до директории с кешированными данными
             * @private
             */
            dirname: path.resolve(env.get("cache.dir")),

            /**
             * @description Можно ли сохранять файлы
             */
            inFile: env.get("cache.file"),

            /**
             * @description Включена ли система кеширования
             */
            isOn: env.get("cache")
        };

        /**
         * @description База данных треков
         * @readonly
         * @private
         */
        private readonly data = {
            /**
             * @description Кешированные треки
             */
            tracks: null as Map<string, Track>,

            /**
             * @description Класс кеширования аудио файлов
             */
            audio: null as CacheAudio
        };

        /**
         * @description Выдаем класс для кеширования аудио
         * @public
         */
        public get audio(): null | CacheAudio {
            if (!this._options.inFile) return null;
            return this.data.audio;
        };

        /**
         * @description Путь до директории кеширования
         * @public
         */
        public get dirname() { return this._options.dirname; };

        /**
         * @description Можно ли сохранять кеш в файл
         * @public
         */
        public get inFile() { return this._options.inFile; };

        /**
         * @description Включена ли система кеширования
         * @public
         */
        public get isOn() { return this._options.isOn; };

        /**
         * @description Задаем параметры при запуске класса
         * @public
         */
        public constructor() {
            if (this.inFile) this.data.audio = new CacheAudio(this._options.dirname);
            else this.data.tracks = new Map<string, Track>();
        };

        /**
         * @description Сохраняем данные в класс
         * @param track - Кешируемый трек
         */
        public set = (track: Track) => {
            // Если включен режим без кеширования в файл
            if (!this.inFile) {
                const song = this.data.tracks.get(track.id);

                // Если уже сохранен трек
                if (song) return;

                this.data.tracks.set(track.id, track);
                return;
            }

            setImmediate(() => {
                // Если нет директории Data
                if (!fs.existsSync(`${this.dirname}/Data`)) {
                    let dirs = `${this.dirname}/Data`.split("/");
                    fs.mkdir(dirs.join("/"), {recursive: true}, () => {
                    });
                }

                // Сохраняем данные в файл
                if (!fs.existsSync(`${this.dirname}/Data/[${track.id}].json`)) {
                    // Создаем файл
                    fs.createWriteStream(`${this.dirname}/Data/[${track.id}].json`).destroy();

                    // Записываем данные в файл
                    fs.writeFile(`${this.dirname}/Data/[${track.id}].json`, JSON.stringify({
                        ...track["_track"],
                        time: {total: `${track["_duration"]["total"]}`},
                        // Не записываем в кеш аудио, он будет в кеше
                        audio: null
                    }), () => null);
                }
            });
        };

        /**
         * @description Выдаем данные из класса
         * @param ID - Идентификатор трека
         */
        public get = (ID: string): Track | null => {
            // Если включен режим без кеширования в файл
            if (!this.inFile) {
                const track = this.data.tracks.get(ID);

                // Если трек кеширован в память, то выдаем данные
                if (track) return track;
                return null;
            }

            // Если есть трек в кеше
            if (fs.existsSync(`${this.dirname}/Data/[${ID}].json`)) {
                // Если трек кеширован в файл
                const json = JSON.parse(fs.readFileSync(`${this.dirname}/Data/[${ID}].json`, 'utf8'));

                // Если трек был найден среди файлов
                if (json) return new Track(json);
            }
            return null;
        };
    };

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения кнопок бота
     * @description Класс хранящий в себе все кнопки для бота
     * @readonly
     * @public
     */
    public readonly buttons = new class Database_buttons extends Collection<ButtonCallback, SupportButtons> {
        public constructor() {
            super();

            /**
             * @description Включение случайного трека
             * @button shuffle
             */
            this.set("shuffle", (msg) => {
                const queue = msg.queue;

                // Если в очереди менее 2 треков
                if (queue.tracks.size < 2) {
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.shuffle.fail"),
                        color: Colors.Yellow
                    };
                    return;
                }

                // Включение тасовки очереди
                queue.tracks.shuffle = !queue.tracks.shuffle;

                // Отправляем сообщение о включении или выключении тасовки
                msg.FBuilder = {
                    description: locale._(msg.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                    color: Colors.Green
                };
                return;
            });

            /**
             * @description Включение прошлого трека
             * @button last
             */
            this.set("back", (msg) => {
                const queue = msg.queue;
                const oldState = queue.player.tracks.repeat;

                queue.player.tracks.repeat = RepeatType.Songs;

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position - 1);

                queue.player.tracks.repeat = oldState;

                // Уведомляем пользователя о смене трека
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.last"),
                    color: Colors.Yellow
                };

                return;
            });

            /**
             * @description Кнопка паузы/проигрывания
             * @button resume_pause
             */
            this.set("resume_pause", (msg) => {
                const queue = msg.queue;

                // Если плеер уже проигрывает трек
                if (queue.player.status === "player/playing") {
                    // Приостанавливаем музыку если она играет
                    queue.player.pause();

                    // Сообщение о паузе
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.pause"),
                        color: Colors.Green
                    };
                }

                // Если плеер на паузе
                else if (queue.player.status === "player/pause") {
                    // Возобновляем проигрывание если это возможно
                    queue.player.resume();

                    // Сообщение о возобновлении
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.resume"),
                        color: Colors.Green
                    };
                }

                return;
            });

            /**
             * @description Кнопка пропуска текущего трека
             * @button skip
             */
            this.set("skip", (msg) => {
                const queue = msg.queue;

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position + 1);

                // Уведомляем пользователя о пропущенном треке
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.skip"),
                    color: Colors.Green
                };
                return;
            });

            /**
             * @description Включение и выключение повтора
             * @button repeat
             */
            this.set("repeat", (msg) => {
                const queue = msg.queue, loop = queue.tracks.repeat;

                // Включение всех треков
                if (loop === RepeatType.None) {
                    queue.tracks.repeat = RepeatType.Songs;

                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.songs"),
                        color: Colors.Green
                    };
                    return;
                }

                // Включение повтора трека
                else if (loop === RepeatType.Songs) {
                    queue.tracks.repeat = RepeatType.Song;
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.song"),
                        color: Colors.Green
                    };
                    return;
                }

                queue.tracks.repeat = RepeatType.None;
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.off"),
                    color: Colors.Green
                };
                return;
            });


            /**
             * @description Повтор текущего трека
             * @button replay
             */
            this.set("replay", (msg) => {
                const queue = msg.queue;

                // Запускаем проигрывание текущего трека
                queue.player.play();

                // Сообщаем о том что музыка начата с начала
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.replay", [queue.tracks.track.title]),
                    color: Colors.Green
                };
                return;
            });


            /**
             * @description Показ текущих треков
             * @button queue
             */
            this.set("queue", (msg) => {
                const queue = msg.queue;
                const page = parseInt((queue.tracks.position / 5).toFixed(0));
                const pages = queue.tracks.array(5, true) as string[];
                const embed: EmbedData = {
                    color: Colors.Green,
                    author: {
                        name: `${locale._(msg.locale, "queue")} - ${msg.guild.name}`,
                        iconURL: queue.tracks.track.artist.image.url
                    },
                    thumbnail: {
                        url: msg.guild.iconURL()
                    },
                    fields: [
                        {
                            name: locale._(msg.locale, "player.current.playing"),
                            value: `\`\`${queue.tracks.position + 1}\`\` - ${queue.tracks.track.titleReplaced}`
                        },
                        pages.length > 0 ? {name: locale._(msg.locale, "queue"), value: pages[page]} : null
                    ],
                    footer: {
                        text: locale._(msg.locale, "player.button.queue.footer", [queue.tracks.track.user.displayName, page + 1, pages.length, queue.tracks.total, queue.tracks.time]),
                        iconURL: queue.tracks.track.user.avatar
                    },
                    timestamp: queue.timestamp
                };

                new msg.builder().addEmbeds([embed])
                    .setMenu({type: "table", pages, page})
                    .setTime(60e3)
                    .setCallback((message, pages: string[], page: number) => {
                        return message.edit({
                            embeds: [
                                {
                                    ...embed as any,
                                    color: Colors.Green,
                                    fields: [
                                        embed.fields[0],
                                        {
                                            name: locale._(msg.locale, "queue"),
                                            value: pages[page]
                                        }
                                    ],
                                    footer: {
                                        ...embed.footer,
                                        text: locale._(msg.locale, "player.button.queue.footer", [msg.author.username, page + 1, pages.length, queue.tracks.total, queue.tracks.time])
                                    }
                                }
                            ]
                        });
                    }).send = msg;
                return;
            });


            /**
             * @description Показ включенных фильтров
             * @button filters_menu
             */
            this.set("filters", (msg) => {
                const queue = msg.queue;
                const filters = queue.player.filters.enabled;

                // Если нет фильтров
                if (filters.length === 0) {
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.filter.zero"),
                        color: Colors.White
                    };
                    return;
                }

                // Отправляем список включенных фильтров
                new msg.builder().addEmbeds([
                    {
                        description: locale._(msg.locale, "player.button.filter"),
                        color: Colors.White,
                        author: {
                            name: `${locale._(msg.locale, "filters")} - ${msg.guild.name}`,
                            iconURL: queue.tracks.track.artist.image.url
                        },
                        thumbnail: {
                            url: msg.guild.iconURL()
                        },

                        fields: filters.map((item) => {
                            return {
                                name: item.name,
                                value: item.locale[msg.locale] ?? item.locale["en-US"],
                                inline: true
                            }
                        }),
                        timestamp: new Date()
                    }
                ]).send = msg;
                return;
            });


            /**
             * @description Показ теста трека
             * @button lyrics
             */
            this.set("lyrics", (msg) => {
                const queue = msg.queue;
                const track = queue.tracks.track;

                // Получаем текст песни
                track.lyrics

                    // При успешном ответе
                    .then((item) => {
                        // Отправляем сообщение с текстом песни
                        new msg.builder().addEmbeds([
                            {
                                color: Colors.White,
                                thumbnail: track.image,
                                author: {
                                    name: track.title,
                                    url: track.url,
                                    iconURL: track.artist.image.url
                                },
                                description: `\`\`\`css\n${item !== undefined ? item : locale._(msg.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                timestamp: new Date()
                            }
                        ]).setTime(20e3).send = msg;
                    })

                    // При ошибке, чтобы процесс нельзя было сломать
                    .catch((error) => {
                        Logger.log("ERROR", error);

                        // Отправляем сообщение с текстом песни
                        new msg.builder().addEmbeds([
                            {
                                color: Colors.White,
                                thumbnail: track.image,
                                author: {
                                    name: track.title,
                                    url: track.url,
                                    iconURL: track.artist.image.url
                                },
                                description: `\`\`\`css\n${locale._(msg.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                timestamp: new Date()
                            }
                        ]).setTime(20e3).send = msg;
                    })
                return;
            });

            /**
             * @description Остановка проигрывания
             * @button stop_music
             */
            this.set("stop", (msg) => {
                const queue = msg.queue;

                // Если есть очередь, то удаляем ее
                if (queue) queue.cleanup();

                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.stop"),
                    color: Colors.Green
                };
                return;
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения команд
     * @readonly
     * @public
     */
    public readonly commands = new Commands();

    /**
     * @description Для управления белым списком пользователей
     * @readonly
     * @public
     */
    public readonly whitelist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("whitelist"),
        ids: env.get("whitelist.list", "").split(",")
    };

    /**
     * @description Для управления черным списком пользователей
     * @readonly
     * @public
     */
    public readonly blacklist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("blacklist"),
        ids: env.get("blacklist.list", "").split(",")
    };

    /**
     * @description Для работы с командами для разработчика
     * @readonly
     * @public
     */
    public readonly owner: {ids: string[]; guildID: string} = {
        guildID: env.get("owner.server"),
        ids: env.get("owner.list").split(",")
    };

    /**
     * @description Для отображения в embed сообщениях
     * @readonly
     * @public
     */
    public readonly images: {disk: string; no_image: string; loading: string} = {
        disk: env.get("image.currentPlay"),
        no_image: env.get("image.not"),
        loading: env.get("loading.emoji")
    };
}

/**
 * @author SNIPPIK
 * @description Класс для сохранения аудио файлов
 * @support ogg/opus
 * @class CacheAudio
 * @private
 */
class CacheAudio extends Cycle<Track> {
    /**
     * @description Путь до директории с кешированными данными
     * @readonly
     * @private
     */
    private readonly cache_dir: string = null;

    /**
     * @description Запускаем работу цикла
     * @constructor
     * @public
     */
    public constructor(cache_dir: string) {
        super({
            name: "AudioFile",
            duration: "promise",
            filter: (item) => {
                const names = this.status(item);

                //Если уже скачено или не подходит для скачивания то, пропускаем
                if (names.status === "ended" || item.time.total > 600) {
                    this.remove(item);
                    return false;

                    //Если нет директории то, создаем ее
                } else if (!fs.existsSync(names.path)) {
                    let dirs = names.path.split("/");

                    if (!names.path.endsWith("/")) dirs.splice(dirs.length - 1);
                    fs.mkdirSync(dirs.join("/"), {recursive: true});
                }
                return true;
            },
            execute: (track) => {
                return new Promise<boolean>((resolve) => {
                    const status = this.status(track);

                    // Создаем ffmpeg для скачивания трека
                    const ffmpeg = new Process([
                        "-vn", "-loglevel", "panic",
                        "-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5",
                        "-i", track.link,
                        "-f", `opus`,
                        `${status.path}.opus`
                    ]);

                    // Если была получена ошибка
                    ffmpeg.stdout.once("error", () => {
                        return resolve(false);
                    });

                    // Если запись была завершена
                    ffmpeg.stdout.once("close", () => {
                        return resolve(true);
                    });
                });
            }
        });

        this.cache_dir = cache_dir;
    };

    /**
     * @description Получаем статус скачивания и путь до файла
     * @param track
     */
    public status = (track: Track): { status: "not-ended" | "ended" | "download", path: string } => {
        const file = `${this.cache_dir}/Audio/[${track.id}]`;

        // Если файл был найден в виде opus
        if (fs.existsSync(`${file}.opus`)) return { status: "ended", path: `${file}.opus`};

        // Выдаем что ничего нет
        return { status: "not-ended", path: file };
    };
}