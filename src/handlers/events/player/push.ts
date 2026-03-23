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
    async run(msg, queue, obj) {
        const user = msg.author;

        // Ловим ошибку если она будет связана с api discord
        try {
            // Если есть очередь и треки для показа
            if (obj && queue) {
                const buildComponents = () => {
                    const isTrack = obj instanceof Track;
                    const artist = obj["artist"];
                    const image = obj.image?.["url"] ? obj.image?.["url"] : obj.image ?? db.images.no_image;
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
                                    media: {
                                        url: image
                                    }
                                }
                            },
                            { type: 14, spacing: 2, divider: true },
                            {
                                type: 10,
                                content: `> -# \`👤 ${user.username}\` | \`🕐 ${totalTime.duration(false)}\` • \`🎶 ${queue.tracks.total}\``
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
                    //flags: MessageFlags.IsComponentsV2,
                    components: [buildComponents() as any],
                    //embeds: null
                });

                if (local_msg) setTimeout(() => local_msg.delete?.().catch(() => null), 20e3);
                return;
            }
        } catch (err) {
            console.log(err);
        }

        // Запускаем таймер удаления сообщения
        if (msg) setTimeout(() => msg.delete?.().catch(() => null), 20e3);
    }
})