import { Assign, Logger } from "#structures";
import { Button } from "#handler/components";
import { RepeatType } from "#service/player";
import { locale } from "#service/locale";
import { Colors } from "discord.js";
import { db } from "#app/db";

/**
 * @description Кнопка stop, отвечает за остановку проигрывания
 * @class ButtonStop
 * @extends Assign
 * @loadeble
 */
class ButtonStop extends Assign<Button> {
    public constructor() {
        super({
            name: "stop",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);

                // Если есть очередь, то удаляем ее
                if (queue) queue.cleanup();

                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.stop"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка skip, отвечает за пропуск текущего трека
 * @class ButtonSkip
 * @extends Assign
 * @loadeble
 */
class ButtonSkip extends Assign<Button> {
    public constructor() {
        super({
            name: "skip",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position + 1);

                // Уведомляем пользователя о пропущенном треке
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.skip"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка back, отвечает за возврат к прошлому треку
 * @class ButtonBack
 * @extends Assign
 * @loadeble
 */
class ButtonBack extends Assign<Button> {
    public constructor() {
        super({
            name: "back",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);
                const repeat = queue.tracks.repeat;

                // Делаем повтор временным
                if (repeat === RepeatType.None) queue.tracks.repeat = RepeatType.Songs;

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position - 1);

                // Возвращаем повтор
                queue.tracks.repeat = repeat;

                // Уведомляем пользователя о смене трека
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.last"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка filters, отвечает за отображение включенных фильтров
 * @class ButtonFilters
 * @extends Assign
 * @loadeble
 */
class ButtonFilters extends Assign<Button> {
    public constructor() {
        super({
            name: "filters",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);
                const filters = queue.player.filters.enabled;

                // Если нет фильтров
                if (filters.length === 0) {
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.filter.zero"),
                                color: Colors.White
                            }
                        ]
                    });
                }

                // Отправляем список включенных фильтров
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.filter"),
                            color: Colors.White,
                            author: {
                                name: `${locale._(message.locale, "filters")} - ${message.guild.name}`,
                                icon_url: queue.tracks.track.artist.image.url
                            },
                            thumbnail: {
                                url: message.guild.iconURL()
                            },

                            fields: filters.map((item) => {
                                return {
                                    name: item.name,
                                    value: item.locale[message.locale] ?? item.locale["en-US"],
                                    inline: true
                                }
                            }),
                            timestamp: new Date() as any
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка lyrics, отвечает за показ текста песни
 * @class ButtonLyrics
 * @extends Assign
 * @loadeble
 */
class ButtonLyrics extends Assign<Button> {
    public constructor() {
        super({
            name: "lyrics",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);
                const track = queue.tracks.track;

                // Получаем текст песни
                track.lyrics

                    // При успешном ответе
                    .then((item) => {
                        // Отправляем сообщение с текстом песни
                        return message.reply({
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
                                    description: `\`\`\`css\n${item !== undefined ? item : locale._(message.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                    timestamp: new Date() as any
                                }
                            ]
                        });
                    })

                    // При ошибке, чтобы процесс нельзя было сломать
                    .catch((error) => {
                        Logger.log("ERROR", error);

                        // Отправляем сообщение с текстом песни
                        return message.reply({
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
                                    description: `\`\`\`css\n${locale._(message.locale, "player.button.lyrics.fail")}\n\`\`\``,
                                    timestamp: new Date() as any
                                }
                            ]
                        });
                    })
            }
        });
    };
}

/**
 * @description Кнопка pause/resume, отвечает за остановку проигрывания или возобновление
 * @class ButtonPlayToggle
 * @extends Assign
 * @loadeble
 */
class ButtonPlayToggle extends Assign<Button> {
    public constructor() {
        super({
            name: "resume_pause",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);
                const track = queue.tracks.track;

                // Если указан трек которого нет
                if (!track) return null;

                const {name, url} = track;

                // Если плеер уже проигрывает трек
                if (queue.player.status === "player/playing") {
                    // Приостанавливаем музыку если она играет
                    queue.player.pause();

                    // Сообщение о паузе
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.pause", [`[${name}](${url})`]),
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
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.resume", [`[${name}](${url})`]),
                                color: Colors.Green
                            }
                        ]
                    });
                }
                return null;
            }
        });
    };
}

/**
 * @description Кнопка queue, отвечает за показ текущих треков
 * @class ButtonQueue
 * @extends Assign
 * @loadeble
 */
class ButtonQueue extends Assign<Button> {
    public constructor() {
        super({
            name: "queue",
            callback: async (message) => {
                const lang = message.locale;
                const queue = db.queues.get(message.guildId);
                let page = parseInt((queue.tracks.position / 5).toFixed(0));
                const pages = parseInt((queue.tracks.total / 5).toFixed(0));

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
                                    "content": `# ${locale._(lang, "queue")} - ${message.guild.name}`
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
                    const msg = await message.reply({ flags: "IsComponentsV2", components: getContainer(0), withResponse: true });
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
                            try { return resource.delete(); } catch { return null; }
                        }

                        // Редактируем сообщение
                        return resource.edit({ components: getContainer(page) });
                    });

                    // Таймер для удаления сообщения
                    setTimeout(() => resource.deletable ? resource.delete().catch(() => null) : null, 60e3);
                } catch (error) {
                    Logger.log("ERROR", `[Failed send message/queue]: ${error}`);
                }
            }
        });
    };
}

/**
 * @description Кнопка repeat, отвечает за переключение режима повтора
 * @class ButtonRepeat
 * @extends Assign
 * @loadeble
 */
class ButtonRepeat extends Assign<Button> {
    public constructor() {
        super({
            name: "repeat",
            callback: (message) => {
                const queue = db.queues.get(message.guildId), loop = queue.tracks.repeat;

                // Включение всех треков
                if (loop === RepeatType.None) {
                    queue.tracks.repeat = RepeatType.Songs;

                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.repeat.songs"),
                                color: Colors.Green
                            }
                        ]
                    });
                }

                // Включение повтора трека
                else if (loop === RepeatType.Songs) {
                    queue.tracks.repeat = RepeatType.Song;

                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.repeat.song"),
                                color: Colors.Green
                            }
                        ]
                    });
                }

                queue.tracks.repeat = RepeatType.None;

                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.repeat.off"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка replay, отвечает за проигрывание заново
 * @class ButtonReplay
 * @extends Assign
 * @loadeble
 */
class ButtonReplay extends Assign<Button> {
    public constructor() {
        super({
            name: "replay",
            callback: async (message) => {
                const queue = db.queues.get(message.guildId);

                // Запускаем проигрывание текущего трека
                await queue.player.play(0, 0, queue.player.tracks.position);

                // Сообщаем о том что музыка начата с начала
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.replay", [queue.tracks.track.name]),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @description Кнопка shuffle, отвечает за перетасовку треков
 * @class ButtonShuffle
 * @extends Assign
 * @loadeble
 */
class ButtonShuffle extends Assign<Button> {
    public constructor() {
        super({
            name: "shuffle",
            callback: (message) => {
                const queue = db.queues.get(message.guildId);

                // Если в очереди менее 2 треков
                if (queue.tracks.size < 2) {
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.shuffle.fail"),
                                color: Colors.Yellow
                            }
                        ]
                    });
                }

                // Включение тасовки очереди
                queue.tracks.shuffleTracks(!queue.tracks.shuffle);

                // Отправляем сообщение о включении или выключении тасовки
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonStop, ButtonSkip, ButtonBack, ButtonStop, ButtonFilters, ButtonLyrics, ButtonPlayToggle, ButtonQueue, ButtonRepeat, ButtonReplay, ButtonShuffle];