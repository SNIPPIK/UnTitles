import {Interact} from "@lib/discord/utils/Interact";
import {Constructor} from "@handler";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Доступные кнопки
 * @type SupportButtons
 */
type SupportButtons = "shuffle" | "last" | "resume_pause" | "skip" | "repeat" | "replay" | "queue" | "filters_menu" | "lyrics" | "stop_music";

/**
 * @author SNIPPIK
 * @description Класс хранящий в себе все кнопки для бота
 * @class dbl_buttons
 * @public
 */
export class dbl_buttons extends Constructor.Collection<button, SupportButtons> {
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
            queue.shuffle = !queue.shuffle;

            // Отправляем сообщение о включении или выключении тасовки
            msg.fastBuilder = {
                description: locale._(msg.locale, queue.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                color: Colors.Green
            }
        });

        /**
         * @description Включение прошлого трека
         * @button last
         */
        this.set("last", (msg) => {
            const queue = msg.queue;

            // Если играет 1 трек
            if (queue.tracks.position === 0) {
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.last.fail"),
                    color: Colors.Yellow
                };

                return;
            }

            // Меняем позицию трека в очереди
            queue.player.stop_fade(queue.tracks.position - 1);

            // Уведомляем пользователя о смене трека
            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.last"),
                color: Colors.Yellow
            }
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
                }
            }

            // Если плеер на паузе
            else if (queue.player.status === "player/pause") {
                // Возобновляем проигрывание если это возможно
                queue.player.resume();

                // Сообщение о возобновлении
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.resume"),
                    color: Colors.Green
                }
            }
        });

        /**
         * @description Кнопка пропуска текущего трека
         * @button skip
         */
        this.set("skip", (msg) => {
            const queue = msg.queue;

            // Меняем позицию трека в очереди
            queue.player.stop_fade(queue.tracks.position + 1);

            // Уведомляем пользователя о пропущенном треке
            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.skip"),
                color: Colors.Green
            }
        });

        /**
         * @description Включение и выключение повтора
         * @button repeat
         */
        this.set("repeat", (msg) => {
            const queue = msg.queue, loop = queue.repeat;

            // Включение всех треков
            if (loop === "off") {
                queue.repeat = "songs";

                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.songs"),
                    color: Colors.Green
                };
                return;
            }

            // Включение повтора трека
            else if (loop === "songs") {
                queue.repeat = "song";
                msg.fastBuilder = {description: locale._(msg.locale, "player.button.repeat.song"), color: Colors.Green};
                return;
            }

            queue.repeat = "off";
            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.repeat.off"),
                color: Colors.Green
            }
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
        });


        /**
         * @description Показ текущих треков
         * @button queue
         */
        this.set("queue", (msg: Interact) => {
            const queue = msg.queue;
            const page = parseInt((queue.tracks.position / 5).toFixed(0));
            const pages = queue.tracks.arraySort(5);

            new msg.builder().addEmbeds([
                {
                    color: Colors.Green,
                    author: {
                        name: `${locale._(msg.locale, "queue")} - ${msg.guild.name}`,
                        iconURL: db.emojis.diskImage
                    },
                    thumbnail: {
                        url: msg.guild.iconURL()
                    },
                    fields: [
                        {
                            name: locale._(msg.locale, "player.current.playing"),
                            value: `\`${queue.tracks.position + 1}\` - ${queue.tracks.track.titleReplaced}`
                        },
                        pages.length > 0 ? {name: locale._(msg.locale, "queue"), value: pages[page]} : null
                    ],
                    footer: {
                        text: locale._(msg.locale, "player.button.queue.footer", [queue.tracks.track.user.username, page + 1, pages.length, queue.tracks.size, queue.tracks.time]),
                        iconURL: queue.tracks.track.user.avatar
                    },
                    timestamp: new Date()
                }
            ]).setMenu({type: "table", pages, page}).setTime(60e3).setCallback((message, pages: string[], page: number, embed) => {
                return message.edit({
                    embeds: [ //@ts-ignore
                        {
                            ...embed[0],
                            fields: [
                                embed[0].fields[0],
                                {
                                    name: locale._(msg.locale, "queue"),
                                    value: pages[page]
                                }
                            ],
                            footer: {
                                ...embed[0].footer,
                                text: locale._(msg.locale, "player.button.queue.footer", [msg.author.username, page + 1, pages.length, queue.tracks.size, queue.tracks.time])
                            }
                        }
                    ]
                });
            }).send = msg;
        });


        /**
         * @description Показ включенных фильтров
         * @button filters_menu
         */
        this.set("filters_menu", (msg) => {
            const queue = msg.queue;
            const filters = queue.player.filters.enable;

            // Если нет фильтров
            if (filters.length === 0) {
                msg.fastBuilder = {description: locale._(msg.locale, "player.button.filter.zero"), color: Colors.White};
                return;
            }

            // Отправляем список включенных фильтров
            new msg.builder().addEmbeds([
                {
                    description: locale._(msg.locale, "player.button.filter"),
                    color: Colors.White,
                    author: {
                        name: `${locale._(msg.locale, "filters")} - ${msg.guild.name}`,
                        iconURL: db.emojis.diskImage
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
        });


        /**
         * @description Показ теста трека
         * @button lyrics
         */
        this.set("lyrics", (msg) => {
            const queue = msg.queue;
            const track = queue.tracks.track;

            // Получаем текст песни
            track.lyrics.then((item) => {
                // Отправляем сообщение с текстом песни
                new msg.builder().addEmbeds([
                    {
                        color: Colors.White,
                        thumbnail: track.image,
                        author: {
                            name: track.title,
                            url: track.url,
                            iconURL: db.emojis.diskImage
                        },
                        description: `\`\`\`css\n${item !== undefined ? item : locale._(msg.locale, "player.button.lyrics.fail")}\n\`\`\``,
                        timestamp: new Date()
                    }
                ]).setTime(20e3).send = msg;
            });
        });

        /**
         * @description Остановка проигрывания
         * @button stop_music
         */
        this.set("stop_music", (msg) => {
            const queue = msg.queue;

            // Если есть очередь, то удаляем ее
            if (queue) queue.cleanup();
            db.voice.remove(msg.guild.id);

            msg.fastBuilder = {
                description: locale._(msg.locale, "player.button.stop"),
                color: Colors.Green
            };
        });
    };
}

/**
 * @author SNIPPIK
 * @description Что хранит в себе объект кнопки
 * @interface button
 */
type button = (msg: Interact) => void