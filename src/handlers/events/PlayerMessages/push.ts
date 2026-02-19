import { Colors } from "#structures/discord";
import { createEvent } from "seyfert";
import { locale } from "#structures";
import { Track } from "#core/queue";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Сообщение о добавленном треке или плейлисте
 * @extends Event
 * @event message/push
 * @public
 */
export default createEvent({
    data: { name: "message/push" },
    async run(queue, user, obj) {
        const {artist, image} = obj;

        // Отправляем сообщение, о том что было добавлено в очередь
        const msg = await queue.message.send({
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
            } as any]
        }, true);

        // Если есть ответ от отправленного сообщения
        if (msg) setTimeout(() => !!msg.delete ? msg.delete().catch(() => null) : null, 12e3);
    }
})