import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { Colors } from "#structures/discord";
import { MessageFlags } from "discord.js";
import { locale } from "#structures";
import { Track } from "#core/queue";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Сообщение об ошибке
 * @class message_error
 * @extends Event
 * @event message/error
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "message/error",
    type: "player"
})
class message_error extends Event<"message/error"> {
    run: SupportEventCallback<"message/error"> = async (queue, error, position) => {
        // Если нет треков или трека?!
        if (!queue || !queue?.tracks || !queue?.tracks!.track) return null;

        // Данные трека
        const { api, artist, image, user, name } = position ? queue.tracks.get(position) : queue.tracks.track;

        // Создаем сообщение
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
                        value: `\`\`\`js\n${error}\`\`\``
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

        // Если есть ответ от отправленного сообщения
        if (message) setTimeout(() => message.deletable ? message.delete().catch(() => null) : null, 20e3);
    }
}

/**
 * @author SNIPPIK
 * @description Сообщение о добавленном треке или плейлисте
 * @class message_push
 * @extends Event
 * @event message/push
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "message/push",
    type: "player"
})
class message_push extends Event<"message/push"> {
    run: SupportEventCallback<"message/push"> = async (msg, queue, obj) => {
        if (!msg?.author) {
            throw Error("[Message/push]: Not found author in get data");
        }

        // Ловим ошибку если она будет связана с api discord
        try {
            // Если есть очередь и треки для показа
            if (obj && queue) {
                const buildComponents = () => {
                    const isTrack = obj instanceof Track;
                    const artist = obj["artist"];
                    const image: string = obj.image?.["url"] ?? obj.image ?? db.images.no_image;
                    const url = obj["url"];
                    const tracks = isTrack ? [obj] : obj.items.slice(0, 5);
                    const totalTime = isTrack ? obj.time.total : obj.items.reduce((sum, t) => sum + (t?.time?.total ?? 0), 0);
                    const header = artist?.title && isTrack ? `[${artist?.title}](${artist?.url})` : `[${obj["title"]}](${obj?.url})`

                    const component = {
                        type: 17,
                        accent_color: isTrack ? obj.api?.color ?? Colors.Blue : Colors.White,
                        components: [
                            // Основной блок
                            {
                                type: 9,
                                components: [
                                    { type: 10, content: `## ${header}` },
                                    {
                                        type: 10,
                                        content: `\n**${locale._(queue.message.locale, "player.queue.push")}**`
                                    },
                                    {
                                        type: 10,
                                        content: tracks.map((t, idx) => `\`${idx + 1}\` | ${t.name_replace}`).join("\n")
                                    }
                                ],
                                accessory: {
                                    type: 11,
                                    //description: isTrack ? obj.name : obj.title,
                                    media: {
                                        url: image
                                    }
                                }
                            },
                            { type: 14, spacing: 2, divider: true },
                            {
                                type: 10,
                                content: `> -# \`👤 ${msg.author.username}\` | \`🕐 ${totalTime.duration(false)}\` • \`🎶 ${queue.tracks.total}\``
                            },
                            // Кнопки
                            {
                                type: 1,
                                components: [
                                    {type: 2, label: "Link", style: 5, url}
                                ]
                            }
                        ]
                    };

                    if (tracks.length > 5) {
                        component.components[0].components.push(
                            //@ts-ignore
                            {
                                type: 10,
                                content: locale._(queue.message.locale, "player.queue.push.more", [tracks.length - 5])
                            }
                        )
                    }

                    return component;
                };

                const local_msg = await msg.edit({
                    components: [buildComponents()],
                });

                if (local_msg) setTimeout(() => local_msg.delete?.().catch(() => null), 20e3);
                return;
            }
        } catch (err) {
            console.log(err);
        }

        // Запускаем таймер удаления сообщения
        if (msg) setTimeout(() => msg.delete?.().catch(() => null), 20e3);
    };
}

/**
 * @author SNIPPIK
 * @description Сообщение о том что сейчас играет
 * @class message_playing
 * @extends Event
 * @event message/playing
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "message/playing",
    type: "player"
})
class message_playing extends Event<"message/playing"> {
    run: SupportEventCallback<"message/playing"> = async (queue) => {
        const message = await db.queues.cycles.messages.ensure(queue.message.guild_id, () => {
            return queue.message.send({
                components: queue.components,
                withResponse: true,
                flags: MessageFlags.SuppressNotifications | MessageFlags.IsComponentsV2
            });
        });

        // Меняем статус голосового канала
        db.adapter.status(queue.message.voice_id, `${db.images.disk_emoji} | ${queue.tracks.track.name}`);

        // Если есть сообщение
        if (message) db.queues.cycles.messages.update(message, queue.components);
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [message_playing, message_push, message_error];