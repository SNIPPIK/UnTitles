import {Colors} from "discord.js";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Event} from "@handler/events";
import {Assign} from "@utils";
import {db} from "@app/db";

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
            execute: async (queue, error, position) => {
                // Если нет треков или трека?!
                if (!queue || !queue?.tracks || !queue?.tracks!.track) return null;

                // Данные трека
                const {api, artist, image, user, name} = position ? queue.tracks.get(position) : queue.tracks.track;
                const message = await queue.message.send({
                    embeds: [{
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
                            text: `${user.username} | ${queue.tracks.time} | 🎶: ${queue.tracks.size}`,
                            iconURL: user?.avatar
                        }
                    }],
                    withResponse: true
                });

                if (message) setTimeout(() => message.delete().catch(() => {}), 20e3);
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
            execute: async (message, obj) => {
                const {artist, image } = obj;

                // Отправляем сообщение, о том что было добавлено в очередь
                const msg = await message.channel.send({
                    embeds: [{
                        color: obj["api"] ? obj["api"]["color"] : Colors.Blue,
                        thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.images.no_image},
                        footer: {
                            icon_url: message.member.avatarURL(),
                            text: `${message.member.displayName}`
                        },
                        author: {
                            name: artist?.title,
                            url: artist?.url,
                            icon_url: db.images.disk
                        },
                        fields: [
                            {
                                name: locale._(message.locale, "player.queue.push"),
                                value: obj instanceof Track ?
                                    // Если один трек в списке
                                    `\`\`\`[${obj.time.split}] - ${obj.name}\`\`\`` :

                                    // Если добавляется список треков (альбом или плейлист)
                                    `${obj.items.slice(0, 5).map((track, index) => {
                                        return `\`${index + 1}\` ${track.name_replace}`;
                                    }).join("\n")}${obj.items.length > 5 ? locale._(message.locale, "player.queue.push.more", [obj.items.length - 5]) : ""}
                                    `
                            }
                        ]
                    }]
                });

                if (msg) setTimeout(() => msg.delete().catch(() => {}), 12e3);
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
            execute: async (queue) => {
                const message = await queue.message.send({embeds: [queue.componentEmbed], components: queue.components, withResponse: true});

                if (message) {
                    // Добавляем новое сообщение в базу с сообщениями, для последующего обновления
                    if (!db.queues.cycles.messages.has(message)) {
                        // Добавляем сообщение в базу для обновления
                        db.queues.cycles.messages.add(message);
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [message_playing, message_push, message_error];