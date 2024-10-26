import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {API, Constructor, Handler} from "@handler";
import {Song} from "@lib/player/queue";
import {db} from "@lib/db";
import {locale} from "@lib/locale";

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
                const {color, author, image, title, requester} = queue.songs.song;
                new queue.message.builder().addEmbeds([
                    {
                        color, thumbnail: image, timestamp: new Date(),
                        fields: [
                            {
                                name: locale._(queue.message.locale, "player.current.playing"),
                                value: `\`\`\`${title}\`\`\``
                            },
                            {
                                name: locale._(queue.message.locale, "player.current.error"),
                                value: `\`\`\`js\n${error}...\`\`\``
                            }
                        ],
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        footer: {
                            text: `${requester.username} | ${queue.songs.time} | 🎶: ${queue.songs.size}`,
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
                            iconURL: message.author.avatarURL()
                        },
                        author: {
                            name: author?.title,
                            url: author?.url,
                            iconURL: db.emojis.diskImage
                        },
                        fields: [
                            {
                                name: locale._(message.locale, "player.queue.push"),
                                value: obj instanceof Song ? `${obj.titleReplaced}` : `${obj.items.slice(0, 5).map((track, index) => {
                                    return `\`${index + 1}\` ${track.titleReplaced}`;
                                }).join("\n")}${obj.items.length > 5 ? `\nAnd ${obj.items.length - 5} tracks...` : ""}`
                            }
                        ]
                    }
                ]).setTime(20e3).send = message;
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
            execute: (tracks, _, message) => {
                // Если не нашлись треки
                if (tracks?.length < 1 || !tracks) {
                    new message.builder().addEmbeds([
                        {
                            description: locale._(message.locale, "player.search.fail"),
                            color: Colors.DarkRed
                        }
                    ]).setTime(7e3).send = message;
                    return;
                }

                // Отправляем список найденных треков
                new message.builder().addEmbeds([{description: locale._(message.locale, "player.search")}]).setTime(30e3).addComponents([
                    new ActionRowBuilder()
                        .addComponents(new StringSelectMenuBuilder()
                            .setCustomId("search-menu")
                            .setOptions(...tracks.map((track) => {
                                    return {
                                        label: `${track.title}`,
                                        description: `${track.author.title} | ${track.duration.full}`,
                                        value: track.url
                                    }
                                }), {label: locale._(message.locale, "cancel"), value: "stop"}
                            )
                        )
                ]).send = message;
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
                const {color, author, image, title, url, duration, platform} = queue.songs.song;
                const embed = new queue.message.builder().addEmbeds([
                    {
                        color, thumbnail: image,
                        author: {name: author.title, url: author.url, iconURL: db.emojis.diskImage},
                        fields: [

                            // Текущий трек
                            {
                                name: locale._(queue.message.locale, "player.current.playing"),
                                value: `\`\`\`${title}\`\`\`[|](${url})`
                            },

                            //Следующий трек или треки
                            queue.songs.size > 1 ? (() => {
                                const tracks = queue.songs.next().map((track, index) => {
                                    return `\`${index + 2}\` ${track.titleReplaced}`;
                                });

                                if (queue.songs.size > 5) return {
                                    name: locale._(queue.message.locale, "player.next.playing.alt", [queue.songs.size]),
                                    value: tracks.join("\n")
                                };
                                return {name: locale._(queue.message.locale, "player.next.playing"), value: tracks.join("\n")};
                            })() : null,

                            // Прогресс бар
                            {
                                name: "",
                                value: (() => {
                                    const current = queue.player.stream?.current?.duration || 0;
                                    return `\n\`\`${current.duration()}\`\` ${queue.player.progress.bar} \`\`${duration.full}\`\``;
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
                    message.edit({ embeds: embed.embeds as any, components: queue.components as any });
                    return;
                }

                embed.setTime(0).addComponents(queue.components as any).send = queue.message;
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onPlaying, onError, onSearch, onPush});