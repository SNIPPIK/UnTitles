import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { Logger, locale } from "#structures";
import { RepeatType } from "#core/queue";
import { Message } from "discord.js";
import { db } from "#app/db";

/**
 * @description Кнопка stop, отвечает за остановку проигрывания
 * @class ButtonStop
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "stop"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonStop extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Если есть очередь, то удаляем ее
        if (queue) queue.cleanup();

        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.stop"),
                    color: Colors.Green
                }
            ]
        });
    }
}

/**
 * @description Кнопка skip, отвечает за пропуск текущего трека
 * @class ButtonSkip
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "skip"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonSkip extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const position = queue.tracks.position + 1;

        // Если позиция больше чем есть треков
        if (position > queue.tracks.total) {
            // Переключаем на 0 позицию
            queue.tracks.position = 0;

            // Переключаемся на первый трек
            await queue.player.play(0, 0, queue.tracks.position);
        }

        else {
            // Переключаемся вперед
            await queue.player.play(0, 0, position);
        }

        // Уведомляем пользователя о пропущенном треке
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.skip"),
                    color: Colors.Green
                }
            ]
        });
    };
}

/**
 * @description Кнопка back, отвечает за возврат к прошлому треку
 * @class ButtonBack
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "back"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonBack extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const repeat = queue.tracks.repeat;
        const position = queue.tracks.position;

        // Делаем повтор временным
        if (repeat === RepeatType.None) queue.tracks.repeat = RepeatType.Songs;

        // Если позиция меньше или равна 0
        if (position <= 0) {
            // Переключаем на 0 позицию
            queue.tracks.position = queue.tracks.total - 1;

            // Переключаемся на последний трек
            await queue.player.play(0, 0, queue.tracks.position);
        }

        else {
            // Переключаемся на прошлый трек
            await queue.player.play(0, 0, position - 1);
        }

        // Возвращаем повтор
        queue.tracks.repeat = repeat;

        // Уведомляем пользователя о смене трека
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.last"),
                    color: Colors.Green
                }
            ]
        });
    };
}

/**
 * @description Кнопка filters, отвечает за отображение включенных фильтров
 * @class ButtonFilters
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "filters"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonFilters extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const filters = queue.player.filters.enabled;

        // Если нет фильтров
        if (filters.size === 0) {
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.filter.zero"),
                        color: Colors.White
                    }
                ]
            });
        }

        // Отправляем список включенных фильтров
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.filter"),
                    color: Colors.White,
                    author: {
                        name: `${locale._(ctx.locale, "filters")} - ${ctx.guild.name}`,
                        icon_url: queue.tracks.track.artist.image.url
                    },
                    thumbnail: {
                        url: ctx.guild.iconURL()
                    },

                    fields: filters.array.map((item) => {
                        return {
                            name: item.name,
                            value: item.locale[ctx.locale] ?? item.locale["en-US"],
                            inline: true
                        }
                    }),
                    timestamp: new Date() as any
                }
            ]
        });
    };
}

/**
 * @description Кнопка lyrics, отвечает за показ текста песни
 * @class ButtonLyrics
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "lyrics"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonLyrics extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.track;

        // Ожидаем ответа от кода со стороны Discord
        await ctx.deferReply().catch(() => {});
        let msg: Message;

        // Получаем текст песни
        track.lyrics

            // При успешном ответе
            .then(async (item) => {
                // Отправляем сообщение с текстом песни
                msg = await ctx.followUp({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${item !== undefined ? item : locale._(ctx.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })

            // При ошибке, чтобы процесс нельзя было сломать
            .catch(async (error) => {
                Logger.log("ERROR", error);

                // Отправляем сообщение с текстом песни
                msg = await ctx.followUp({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${locale._(ctx.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })


        setTimeout(() => msg.deletable ? msg.delete().catch(() => null) : null, 40e3);
    };
}

/**
 * @description Кнопка pause/resume, отвечает за остановку проигрывания или возобновление
 * @class ButtonPlayToggle
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "resume_pause"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonPlayToggle extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.track;

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url} = track;

        // Если плеер уже проигрывает трек
        if (queue.player.status === "player/playing") {
            // Приостанавливаем музыку если она играет
            queue.player.pause();

            // Сообщение о паузе
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.pause", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }

        // Если плеер на паузе
        else if (queue.player.status === "player/pause") {
            // Возобновляем проигрывание если это возможно
            queue.player.resume();

            // Сообщение о возобновлении
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.resume", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }
        return null;
    };
}

/**
 * @description Кнопка queue, отвечает за показ текущих треков
 * @class ButtonQueue
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "queue"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonQueue extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const lang = ctx.locale;
        const queue = db.queues.get(ctx.guildId);
        const pageSize = 5;

        // Текущая страница (с 1)
        let page = Math.floor(queue.tracks.position / pageSize);
        // Общее количество страниц (минимум 1)
        const pages = Math.max(1, Math.ceil(queue.tracks.total / pageSize));

        // Получаем контейнер на 2 версии компонентов
        const getContainer = (position: number) => {
            const components = [];

            // Переводим треки в новый стиль!
            for (const track of queue.tracks.array(5, position * 5)) {
                components.push(
                    {
                        "type": 9,
                        "components": [
                            {
                                "type": 10,
                                "content": `### ${db.images.disk_emoji} **[${track.artist.title}](${track.artist.url})**`
                            },
                            {
                                "type": 10,
                                "content": `### **[${track.name}](${track.url})**\n-# ${track.time.split} - ${track.api.name.toLowerCase()}`
                            }
                        ],
                        "accessory": {
                            "type": 11,
                            "media": {
                                "url": track.image.url
                            }
                        }
                    },
                    {
                        "type": 14, // Separator
                        "divider": true,
                        "spacing": 1
                    },
                );
            }

            return [
                {
                    "type": 17, // Container
                    "accent_color": Colors.White,
                    "components": [
                        {
                            "type": 12, // Media
                            items: [
                                {
                                    "media": {
                                        "url": db.images.banner
                                    }
                                }
                            ]
                        },

                        {
                            "type": 10, // Text
                            "content": `# ${locale._(lang, "queue")} - ${ctx.guild.name}`
                        },
                        ...components,
                        {
                            "type": 10, // Text
                            "content": `-# <t:${queue.timestamp}>`
                        },
                        {
                            "type": 10, // Text
                            "content": locale._(lang, "player.button.queue.footer", [queue.tracks.track.user.username, page + 1, pages, queue.tracks.total, queue.tracks.time])
                        },

                        // Кнопки
                        {
                            type: 1,
                            components: [
                                {
                                    type: 2,
                                    style: 2,
                                    emoji: {
                                        name: "⬅"
                                    },
                                    custom_id: "menu_back",
                                },
                                {
                                    type: 2,
                                    style: 4,
                                    emoji: {
                                        name: "🗑️"
                                    },
                                    custom_id: "menu_cancel"
                                },
                                {
                                    type: 2,
                                    style: 2,
                                    emoji: {
                                        name: "➡"
                                    },
                                    custom_id: "menu_next"
                                }
                            ]
                        },
                    ]
                }
            ];
        };

        try {
            // Отправляем сообщение
            const msg = await ctx.reply({flags: "IsComponentsV2", components: getContainer(0), withResponse: true});
            const resource = msg?.resource?.message;

            // Если нет ответа от API
            if (!resource) return;

            // Создаем сборщик
            const collector = resource.createMessageComponentCollector({
                time: 60e3, componentType: 2,
                filter: (click) => click.user.id !== msg.client.user.id
            });

            // Собираем кнопки на которые нажал пользователь
            collector.on("collect", (i) => {
                // Кнопка переключения на предыдущую страницу
                if (i.customId === "menu_back") {
                    // Делаем перелистывание на последнею страницу
                    if (page === 0) page = pages - 1;
                    else if (pages === 1) return null;
                    else page--;
                }

                // Кнопка переключения на предыдущую страницу
                else if (i.customId === "menu_next") {
                    // Делаем перелистывание на первую страницу
                    if (page >= pages) page = 0;
                    else if (pages === 1) return null;
                    else page++;
                }

                // Кнопка отмены
                else if (i.customId === "menu_cancel") {
                    try {
                        return resource.delete();
                    } catch {
                        return null;
                    }
                }

                // Редактируем сообщение
                return resource.edit({components: getContainer(page)});
            });

            // Таймер для удаления сообщения
            setTimeout(() => resource.deletable ? resource.delete().catch(() => null) : null, 60e3);
        } catch (error) {
            Logger.log("ERROR", `[Failed send message/queue]: ${error}`);
        }
    }
}

/**
 * @description Кнопка repeat, отвечает за переключение режима повтора
 * @class ButtonRepeat
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "repeat"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonRepeat extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId), loop = queue.tracks.repeat;

        // Включение всех треков
        if (loop === RepeatType.None) {
            queue.tracks.repeat = RepeatType.Songs;

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.repeat.songs"),
                        color: Colors.Green
                    }
                ]
            });
        }

        // Включение повтора трека
        else if (loop === RepeatType.Songs) {
            queue.tracks.repeat = RepeatType.Song;

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.repeat.song"),
                        color: Colors.Green
                    }
                ]
            });
        }

        queue.tracks.repeat = RepeatType.None;

        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.repeat.off"),
                    color: Colors.Green
                }
            ]
        });
    };
}

/**
 * @description Кнопка replay, отвечает за проигрывание заново
 * @class ButtonReplay
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "replay"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonReplay extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Запускаем проигрывание текущего трека
        await queue.player.play(0, 0, queue.player.tracks.position);

        // Сообщаем о том что музыка начата с начала
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.replay", [queue.tracks.track.name]),
                    color: Colors.Green
                }
            ]
        });
    };
}

/**
 * @description Кнопка shuffle, отвечает за перетасовку треков
 * @class ButtonShuffle
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "shuffle"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonShuffle extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Если в очереди менее 2 треков
        if (queue.tracks.size < 2) {
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.shuffle.fail"),
                        color: Colors.Yellow
                    }
                ]
            });
        }

        // Включение тасовки очереди
        queue.tracks.shuffleTracks(!queue.tracks.shuffle);

        // Отправляем сообщение о включении или выключении тасовки
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                    color: Colors.Green
                }
            ]
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonStop, ButtonSkip, ButtonBack, ButtonFilters, ButtonLyrics, ButtonPlayToggle, ButtonQueue, ButtonRepeat, ButtonReplay, ButtonShuffle];