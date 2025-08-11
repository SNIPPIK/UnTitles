import { Component, DeclareComponent } from "#handler/components";
import { Colors, CycleInteraction } from "#structures/discord";
import { Middlewares } from "#handler/commands";
import { locale, Logger } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка lyrics, отвечает за показ текста песни
 * @class ButtonLyrics
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "lyrics"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonLyrics extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.track;

        // Ожидаем ответа от кода со стороны Discord
        await ctx.deferReply().catch(() => {});
        let msg: CycleInteraction;

        // Получаем текст песни
        track.lyrics

            // При успешном ответе
            .then(async (item) => {
                // Отправляем сообщение с текстом песни
                msg = await ctx.followUp({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${item !== undefined ? item : locale._(ctx.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })

            // При ошибке, чтобы процесс нельзя было сломать
            .catch(async (error) => {
                Logger.log("ERROR", error);

                // Отправляем сообщение с текстом песни
                msg = await ctx.followUp({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${locale._(ctx.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })


        setTimeout(() => msg.deletable ? msg.delete().catch(() => null) : null, 40e3);
    };
}
/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonLyrics];