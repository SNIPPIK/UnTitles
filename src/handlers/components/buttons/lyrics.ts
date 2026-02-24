import { ComponentCommand, type ComponentContext, Logger, WebhookMessage, Middlewares } from 'seyfert';
import { MessageFlags } from "seyfert/lib/types";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId.startsWith("lyrics");
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.track;

        // Ожидаем ответа от кода со стороны Discord
        await ctx.deferReply().catch(() => {});
        let msg: WebhookMessage;

        // Получаем текст песни
        track.lyrics

            // При успешном ответе
            .then(async (item) => {
                // Отправляем сообщение с текстом песни
                msg = await ctx.followup({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${item !== undefined ? item : locale._(ctx.interaction.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })

            // При ошибке, чтобы процесс нельзя было сломать
            .catch(async (error) => {
                Logger.noColor(error);

                // Отправляем сообщение с текстом песни
                msg = await ctx.followup({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            color: Colors.White,
                            thumbnail: track.image,
                            author: {
                                name: track.name,
                                url: track.url,
                                icon_url: track.artist.image.url
                            },
                            description: `\`\`\`css\n${locale._(ctx.interaction.locale, "player.button.lyrics.fail")}\n\`\`\``,
                            timestamp: new Date() as any
                        }
                    ]
                });
            })


        setTimeout(() => msg.delete(), 40e3);
    };
}