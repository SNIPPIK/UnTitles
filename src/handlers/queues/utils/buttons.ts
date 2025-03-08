import {Colors, EmbedData} from "discord.js";
import {RepeatType} from "@service/player";
import {Collection, Logger} from "@utils";
import {locale} from "@service/locale";
import {Interact} from "@utils";

/**
 * @author SNIPPIK
 * @description Доступные кнопки
 * @type SupportButtons
 */
export type SupportButtons = "resume_pause" | "shuffle" | "replay" | "repeat" | "lyrics" | "queue" | "skip" | "stop" | "back" | "filters" | MenuButtons;

/**
 * @author SNIPPIK
 * @description Имена кнопок в меню взаимодействия
 * @type MenuButtons
 */
type MenuButtons = "menu_back" | "menu_select" | "menu_cancel" | "menu_next";

/**
 * @author SNIPPIK
 * @description Что хранит в себе объект кнопки
 * @interface ButtonCallback
 */
type ButtonCallback = (msg: Interact) => void;

/**
 * @author SNIPPIK
 * @description Класс хранящий в себе все кнопки для бота
 * @extends Collection
 * @class dbl_buttons
 */
export class db_buttons extends Collection<ButtonCallback, SupportButtons> {
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
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.shuffle.fail"),
                    color: Colors.Yellow
                };
                return;
            }

            // Включение тасовки очереди
            queue.tracks.shuffle = !queue.tracks.shuffle;

            // Отправляем сообщение о включении или выключении тасовки
            msg.fastBuilder = {
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

            // TODO надо придумать как это сделать без костылей
            queue.player.tracks.repeat = RepeatType.Songs;

            // Меняем позицию трека в очереди
            queue.player.stop(queue.tracks.position - 1);

            // TODO надо придумать как это сделать без костылей
            queue.player.tracks.repeat = oldState;

            // Уведомляем пользователя о смене трека
            msg.fastBuilder = {
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
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.pause"),
                    color: Colors.Green
                };
            }

            // Если плеер на паузе
            else if (queue.player.status === "player/pause") {
                // Возобновляем проигрывание если это возможно
                queue.player.resume();

                // Сообщение о возобновлении
                msg.fastBuilder = {
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
            msg.fastBuilder = {
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

                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.songs"),
                    color: Colors.Green
                };
                return;
            }

            // Включение повтора трека
            else if (loop === RepeatType.Songs) {
                queue.tracks.repeat = RepeatType.Song;
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.song"),
                    color: Colors.Green
                };
                return;
            }

            queue.tracks.repeat = RepeatType.None;
            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.repeat.off"),
                color: Colors.Green
            };
            return;
        });


        /**
         * @description Повтор текущего трека
         * @button replay
         */
        this.set("replay", (msg: Interact) => {
            const queue = msg.queue;

            // Запускаем проигрывание текущего трека
            queue.player.play();

            // Сообщаем о том что музыка начата с начала
            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.replay", [queue.tracks.track.title]),
                color: Colors.Green
            };
            return;
        });


        /**
         * @description Показ текущих треков
         * @button queue
         */
        this.set("queue", (msg: Interact) => {
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
                msg.fastBuilder = {
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

            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.stop"),
                color: Colors.Green
            };
            return;
        });
    };
}