import {Colors, EmbedData} from "discord.js";
import {Assign, MessageUtils} from "@utils";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Event} from "@handler/events";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Сообщение об ошибке
 * @class message_error
 * @event message/error
 * @public
 */
class message_error extends Assign<Event<"message/error">> {
    public constructor() {
        super({
            name: "message/error",
            type: "player",
            once: false,
            execute: (queue, error) => {
                // Если нет треков или трека?!
                if (!queue?.tracks || !queue?.tracks!.track) return;

                const {api, artist, image, user, name} = queue.tracks.track;
                new queue.message.builder().addEmbeds([
                    {
                        color: api.color, thumbnail: image, timestamp: new Date(),
                        fields: [
                            {
                                name: locale._(queue.message.locale, "player.current.playing"),
                                value: `\`\`\`${name}\`\`\``
                            },
                            {
                                name: locale._(queue.message.locale, "player.current.error"),
                                value: `\`\`\`js\n${error}...\`\`\``
                            }
                        ],
                        author: {name: artist.title, url: artist.url, iconURL: artist.image.url},
                        footer: {
                            text: `${user.displayName} | ${queue.tracks.time} | 🎶: ${queue.tracks.size}`,
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
class message_push extends Assign<Event<"message/push">> {
    public constructor() {
        super({
            name: "message/push",
            type: "player",
            once: false,
            execute: (message, obj) => {
                const {artist, image } = obj;

                // Отправляем сообщение, о том что было добавлено в очередь
                new message.builder().addEmbeds([
                    {
                        color: obj["api"] ? obj["api"]["color"] : Colors.Blue,
                        thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.images.no_image},
                        footer: {
                            iconURL: message.author.avatarURL(),
                            text: `${message.author.username}`
                        },
                        author: {
                            name: artist?.title,
                            url: artist?.url,
                            iconURL: db.images.disk
                        },
                        fields: [
                            {
                                name: locale._(message.locale, "player.queue.push"),
                                value: obj instanceof Track ?
                                    // Если один трек в списке
                                    `\`\`\`[${obj.time.split}] - ${obj.name}}\`\`\`` :

                                    // Если добавляется список треков (альбом или плейлист)
                                    `${obj.items.slice(0, 5).map((track, index) => {
                                        return `\`${index + 1}\` ${track.name_replace}`;
                                    }).join("\n")}${obj.items.length > 5 ? locale._(message.locale, "player.queue.push.more", [obj.items.length - 5]) : ""}
                                    `
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
 * @description Сообщение с выбором трека
 * @class message_search
 * @event message/search
 * @public
 */
class message_search extends Assign<Event<"message/search">> {
    public constructor() {
        super({
            name: "message/search",
            type: "player",
            once: false,
            execute: (tracks, platform, message) => {
                // Если не нашлись треки
                if (tracks?.length < 1) {
                    message.FBuilder = {
                        description: locale._(message.locale, "player.search.fail"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                const track = tracks[0];
                const embed: EmbedData = {
                    color: Colors.Green,
                    author: {
                        name: locale._(message.locale, "player.search"),
                        iconURL: track.artist.image.url
                    },
                    description: locale._(message.locale, "player.current.link", [track.url]) + `\`\`\`css\n👤 ${track.artist.title}\n💽 ${track.name.substring(0, 45)}\n\n🕐 ${track.time.split}\n\`\`\``,
                    image: track.image,
                    footer: {
                        text: locale._(message.locale, "player.search.list", [tracks.length, 1, tracks.length])
                    },
                    timestamp: new Date()
                }

                // Создаем сообщение о поиске
                new message.builder().setTime(120e3).setMenu({type: "selector", pages: tracks, page: 0}).addEmbeds([embed])
                    .setCallback((msg, pages: Track[], page, embed, item: Track) => {
                        // Если был выбран объект
                        if (item) {
                            db.events.emitter.emit("api/request", db.api.request(platform), message, item.url);
                            return;
                        }

                        // Текущий трек
                        const track = pages[page];

                        // Обновляем сообщение
                        msg.edit({
                            embeds: [{
                                ...embed[0],
                                description: locale._(message.locale, "player.current.link", [track.url]) + `\`\`\`css\n👤 ${track.artist.title}\n💽 ${track.name.substring(0, 45)}\n\n🕐 ${track.time.split}\n\`\`\``,
                                image: pages[page].image,
                                footer: {
                                    text: locale._(message.locale, "player.search.list", [tracks.length, page + 1, tracks.length])
                                }
                            }]
                        });
                    }
                ).send = message;
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
class message_playing extends Assign<Event<"message/playing">> {
    public constructor() {
        super({
            name: "message/playing",
            type: "player",
            once: false,
            execute: async (queue, message) => {
                const {api, artist, image, name, user} = queue.tracks.track;
                const builder = new queue.message.builder().addEmbeds([
                    {
                        color: api.color, thumbnail: image,
                        author: {name: artist.title, url: artist.url, iconURL: artist.image.url},
                        footer: {
                            text: `${user.displayName} ${queue.tracks.total > 1 ? `| 🎵 ${queue.player.tracks.position + 1} - ${queue.player.tracks.total} 🎶` : ""}`,
                            iconURL: user.avatar
                        },
                        fields: [
                            // Текущий трек
                            {
                                name: "", //locale._(queue.message.locale, "player.current.playing")
                                value: `\`\`\`${name}\`\`\`` + queue.player.progress
                            },

                            // Следующий трек или треки
                            queue.tracks.size > 1 ? (() => {
                                const tracks = (queue.tracks.array(-2) as Track[]).map((track, index) => {
                                    return `\`\`${index + 2}\`\` - ${track.name_replace}`;
                                });

                                return {
                                    name: "",
                                    value: tracks.join("\n")
                                };
                            })() : null
                        ]
                    }
                ]);

                // Отправляем сообщение
                if (!message) {
                    builder.setTime(0).addComponents(queue.components)
                        // Для обновления сообщений
                        .setPromise((msg) => {
                            // Добавляем новое сообщение в базу с сообщениями, для последующего обновления
                            if (!db.queues.cycles.messages.array.includes(msg)) {
                                // Добавляем сообщение в базу для обновления
                                db.queues.cycles.messages.set(msg);

                                // Отменяем удаление если оно начато
                                MessageUtils.deferDeleteMessage(msg.message.id);
                            }
                        })

                        // Создаем новое сообщение
                        .send = queue.message;
                    return;
                }

                // Обновляем сообщение
                message.edit({ embeds: builder._embeds, components: queue.components }).catch(() => null);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({message_playing, message_search, message_push, message_error});