import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {API, Constructor, Handler} from "@handler";
import {Song} from "@lib/player/queue";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @class onError
 * @event message/error
 * @description Сообщение об ошибке
 */
class onError extends Constructor.Assign<Handler.Event<"message/error">> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            execute: (queue, error) => {
                const {color, author, image, title, requester} = queue.songs.last;
                new queue.message.builder().addEmbeds([
                    {
                        color, thumbnail: image, timestamp: new Date(),
                        fields: [
                            {
                                name: `Щас играет;`,
                                value: `\`\`\`${title}\`\`\``
                            },
                            {
                                name: `**Error:**`,
                                value: `\`\`\`js\n${error}...\`\`\``
                            }
                        ],
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        footer: {
                            text: `${requester.username} | ${queue.songs.time()} | 🎶: ${queue.songs.size}`,
                            iconURL: requester?.avatar
                        }
                    }
                ]).setTime(10e3).send = queue.message;
            }
        });
    }
}

/**
 * @author SNIPPIK
 * @class onPush
 * @event message/push
 * @description Сообщение о добавленном треке или плейлисте
 */
class onPush extends Constructor.Assign<Handler.Event<"message/push">> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            execute: (message, obj) => {
                const {author, image} = obj;

                // Отправляем сообщение, о том что было добавлено в очередь
                new message.builder().addEmbeds([
                    {
                        color: obj["color"] ?? Colors.Blue,
                        thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.emojis.noImage},
                        footer: {
                            text: `${message.author.username}`,
                            iconURL: message.author.displayAvatarURL({})
                        },
                        author: {
                            name: author?.title,
                            url: author?.url,
                            iconURL: db.emojis.diskImage
                        },
                        fields: [
                            {
                                name: "Добавлено в очередь:",
                                value: obj instanceof Song ? `\`\`\`${obj.title}\`\`\`\ ` : `\`\`\`${obj.items.slice(1, 5).map((track, index) => {
                                    return `\`${index + 2}\` ${track.titleReplaced}`;
                                }).toString()}\nAnd ${obj.items.length - 5} tracks...\`\`\``
                            }
                        ]
                    }
                ]).setTime(12e3).send = message;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @class onSearch
 * @event message/search
 * @description Сообщение с выбором трека
 */
class onSearch extends Constructor.Assign<Handler.Event<"message/search">> {
    public constructor() {
        super({
            name: "message/search",
            type: "player",
            execute: (tracks, platform, message) => {
                if (tracks?.length < 1 || !tracks) {
                    message.send({
                        embeds: [
                            {
                                description: "Не удалось что то найти, попробуй другое название!",
                                color: Colors.DarkRed
                            }
                        ]
                    });
                    return;
                }

                new message.builder().addEmbeds([{description: "Все что удалось найти!"}]).setTime(30e3)
                    .addComponents([new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId("menu-builder")
                        .setOptions(...tracks.map((track) => {
                                return {
                                    label: `${track.title}`,
                                    description: `${track.author.title} | ${track.duration.full}`,
                                    value: track.url
                                }
                            }), {label: "Отмена", value: "stop"}
                        )
                    )]).setPromise((msg) => {
                        //Создаем сборщик
                        const collector = msg.createMessageComponentCollector({
                            filter: (interaction) => !interaction.user.bot,
                            time: 30e3,
                            max: 1
                        });

                        //Что будет делать сборщик после выбора трека
                        collector.once("collect", (interaction: any) => {
                            const id = interaction.values[0];

                            if (id && id !== "stop") db.audio.queue.events.emit("request/api", message, [platform, id])

                            interaction?.deferReply();
                            interaction?.deleteReply();

                            //Удаляем данные
                            msg.delete = 200;
                            collector.stop();
                        });
                    }).send = message;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @class onPlaying
 * @event message/playing
 * @description Сообщение о том что сейчас играет
 */
class onPlaying extends Constructor.Assign<Handler.Event<"message/playing">> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            execute: (queue, message) => {
                const {color, author, image, title, url, duration, requester, platform} = queue.songs.song;
                const embed = new queue.message.builder().addEmbeds([
                    {
                        color, thumbnail: image,
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        fields: [
                            {
                                name: "Щас играет",
                                value: `\`\`\`${title}\`\`\``
                            },

                            //Следующий трек или треки
                            queue.songs.size > 1 ? (() => {
                                const tracks = queue.songs.slice(1, 5).map((track, index) => {
                                    return `\`${index + 2}\` ${track.titleReplaced}`;
                                });

                                if (queue.songs.size > 5) return {
                                    name: `Следующее - [${queue.songs.size}]`,
                                    value: tracks.join("\n")
                                };
                                return {name: "Следующее:", value: tracks.join("\n")};
                            })() : null,

                            {
                                name: "",
                                value: (() => {
                                    const current = queue.player.stream?.duration || 0;
                                    const progress = new PlayerProgress({ platform,
                                        duration: { current,
                                            total: duration.seconds
                                        }
                                    });

                                    return `\n[|](${url})\`\`${current.duration()}\`\` ${progress.bar} \`\`${duration.full}\`\``;
                                })()
                            }
                        ]
                    }
                ]).setPromise((msg) => {
                    if (!db.audio.cycles.messages.array.includes(msg)) db.audio.cycles.messages.set(msg);
                });

                // Если надо обновить сообщение
                if (message) {
                    //Обновляем сообщение
                    message.edit({ embeds: embed.embeds as any, components: [queue.components as any] });
                    return;
                }

                embed.setTime(0).addComponents([queue.components as any]).send = queue.message;
            }
        });
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

    private get duration() { return this.options.duration; };

    private get emoji() {
        if (!PlayerProgress.emoji) PlayerProgress.emoji = db.emojis.progress;
        return PlayerProgress.emoji;
    };

    private get platform() { return this.options.platform; };

    private get bottom() { return this.emoji["bottom_" + this.platform] || this.emoji.bottom; };

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

    public constructor(options: PlayerProgress["options"]) {
        Object.assign(this.options, options);
        this.options.platform = options.platform.toLowerCase() as any;
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onPlaying, onError, onSearch, onPush});