import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { Colors } from "#structures/discord";
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
    run: SupportEventCallback<"message/push"> = async (queue, user, obj) => {
        const {artist, image} = obj;

        // Отправляем сообщение, о том что было добавлено в очередь
        const msg = await queue.message.send({
            withResponse: true,
            embeds: [{
                color: obj["api"] ? obj["api"]["color"] : Colors.Blue,
                thumbnail: typeof image === "string" ? {url: image} : image ?? {url: db.images.no_image},
                footer: {
                    iconURL: user.avatarURL(),
                    text: `${user.displayName}`
                },
                author: {
                    name: artist?.title,
                    url: artist?.url,
                    iconURL: db.images.disk
                },
                fields: [
                    {
                        name: locale._(queue.message.locale, "player.queue.push"),
                        value: obj instanceof Track ?
                            // Если один трек в списке
                            `\`\`\`[${obj.time.split}] - ${obj.name}\`\`\`` :

                            // Если добавляется список треков (альбом или плейлист)
                            `${obj.items.slice(0, 5).map((track, index) => {
                                return `\`${index + 1}\` ${track.name_replace}`;
                            }).join("\n")}${obj.items.length > 5 ? locale._(queue.message.locale, "player.queue.push.more", [obj.items.length - 5]) : ""}
                                    `
                    }
                ]
            }]
        });

        // Если есть ответ от отправленного сообщения
        if (msg) setTimeout(() => msg.deletable ? msg.delete().catch(() => null) : null, 12e3);
    }
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
                flags: "IsComponentsV2"
            });
        });

        // Меняем статус голосового канала
        db.adapter.status(queue.message.voice_id, `${db.images.disk_emoji} | ${queue.tracks.track.name}`);

        // Если есть сообщение
        if (message) db.queues.cycles.messages.update(message, queue.components).catch(() => null);
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [message_playing, message_push, message_error];