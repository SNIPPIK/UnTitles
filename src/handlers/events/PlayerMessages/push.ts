import { MessageFlags } from "seyfert/lib/types";
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
        const buildComponents = () => {
            const isTrack = obj instanceof Track;
            const artist = obj["artist"];
            const image = obj["image"] ?? { url: db.images.no_image };
            const url = obj["url"];
            const title = isTrack ? obj["name"] : obj["title"];
            const tracks = isTrack ? [obj] : obj.items.slice(0, 5);
            const totalTime = isTrack ? obj.time.total : obj.items.reduce((sum, t) => sum + (t?.time?.total ?? 0), 0);

            const component = {
                type: 17,
                accent_color: isTrack ? obj.api?.color ?? Colors.Blue : Colors.White,
                components: [
                    // Основной блок
                    {
                        type: 9,
                        components: [
                            { type: 10, content: `## [${artist.title}](${artist.url})` },
                            { type: 10, content: `${isTrack ? "" : `\`${title}\``}\n\`${locale._(queue.message.locale, "player.queue.push")}\`` },
                            ...tracks.map((t, idx) => ({ type: 10, content: `\`${idx + 1}\` | ${t.name_replace}` }))
                        ],
                        accessory: { type: 11, media: image }
                    },
                    { type: 14, spacing: 2, divider: true },
                    { type: 10, content: `-# ${user.username} | ${totalTime.duration(false)} | ${queue.tracks.size}/${queue.tracks.total}` },
                    // Кнопки
                    {
                        type: 1,
                        components: [
                            { type: 2, label: "Link", style: 5, url }
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

        //@ts-ignore
        const msg = await queue.message.send({
            flags: MessageFlags.IsComponentsV2,
            components: [buildComponents() as any],
            embeds: null
        }, true);

        if (msg) setTimeout(() => msg.delete?.().catch(() => null), 20e3);
    }
})