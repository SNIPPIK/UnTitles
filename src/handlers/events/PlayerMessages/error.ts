import { createEvent } from "seyfert";
import {locale} from "#structures";

/**
 * @author SNIPPIK
 * @description Сообщение об ошибке
 * @extends Event
 * @event message/error
 * @public
 */
export default createEvent({
    data: {
        name: "message/error"
    },
    async run(queue, error, position) {
        // Если нет треков или трека?!
        if (!queue || !queue?.tracks || !queue?.tracks!.track) return null;

        // Данные трека
        const {api, artist, image, user, name} = position ? queue.tracks.get(position) : queue.tracks.track;

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
            } as any]
        });

        // Если есть ответ от отправленного сообщения
        if (message) setTimeout(() => !!message.delete ? message.delete().catch(() => null) : null, 20e3);
    }
})