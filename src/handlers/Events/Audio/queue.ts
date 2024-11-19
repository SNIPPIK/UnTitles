import {ActionRowBuilder, Colors, StringSelectMenuBuilder} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Track} from "@lib/player/queue";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Сообщение об ошибке
 * @class message_error
 * @event message/error
 * @public
 */
class message_error extends Constructor.Assign<Handler.Event<"message/error">> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            execute: (queue, error) => {
                if (queue?.tracks || queue?.tracks!.song) return;

                const {color, artist, image, title, user} = queue.tracks.song;
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
                        author: {name: artist.title, url: artist.url, iconURL: db.emojis.diskImage},
                        footer: {
                            text: `${user.username} | ${queue.tracks.time} | 🎶: ${queue.tracks.size}`,
                            iconURL: user?.avatar
                        }
                    }
                ]).setTime(10e3).send = queue.message;
            }
        });
    }
}

/**
 * @author SNIPPIK
 * @description Сообщение о добавленном треке или плейлисте
 * @class message_push
 * @event message/push
 * @public
 */
class message_push extends Constructor.Assign<Handler.Event<"message/push">> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            execute: (message, obj) => {
                const {artist, image } = obj;

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
                            name: artist?.title,
                            url: artist?.url,
                            iconURL: db.emojis.diskImage
                        },
                        fields: [
                            {
                                name: locale._(message.locale, "player.queue.push"),
                                value: obj instanceof Track ? `${obj.titleReplaced}` : `${obj.items.slice(0, 5).map((track, index) => {
                                    return `\`${index + 1}\` ${track.titleReplaced}`;
                                }).join("\n")}${obj.items.length > 5 ? locale._(message.locale, "player.queue.push.more", [obj.items.length - 5]) : ""}`
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
 * @description Сообщение с выбором трека
 * @class message_search
 * @event message/search
 * @public
 */
class message_search extends Constructor.Assign<Handler.Event<"message/search">> {
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
                                        description: `${track.artist.title} | ${track.time.split}`,
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
 * @description Сообщение о том что сейчас играет
 * @class message_playing
 * @event message/playing
 * @public
 */
class message_playing extends Constructor.Assign<Handler.Event<"message/playing">> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            execute: (queue, message) => {
                const {color, artist, image, title, url, time, platform} = queue.tracks.song;
                const embed = new queue.message.builder().addEmbeds([
                    {
                        color, thumbnail: image,
                        author: {name: artist.title, url: artist.url, iconURL: db.emojis.diskImage},
                        fields: [

                            // Текущий трек
                            {
                                name: locale._(queue.message.locale, "player.current.playing"),
                                value: `\`\`\`${title}\`\`\`` + locale._(queue.message.locale, "player.current.link", [url])
                            },

                            //Следующий трек или треки
                            queue.tracks.size > 1 ? (() => {
                                const tracks = queue.tracks.next().map((track, index) => {
                                    return `\`${index + 2}\` ${track.titleReplaced}`;
                                });

                                if (queue.tracks.size > 5) return {
                                    name: locale._(queue.message.locale, "player.next.playing.alt", [queue.tracks.size]),
                                    value: tracks.join("\n")
                                };
                                return {name: locale._(queue.message.locale, "player.next.playing"), value: tracks.join("\n")};
                            })() : null,

                            // Прогресс бар
                            {
                                name: "",
                                value: queue.player.progress
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
export default Object.values({message_playing, message_search, message_push, message_error});