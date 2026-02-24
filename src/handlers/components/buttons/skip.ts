import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "skip";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);
        const position = queue.tracks.position + 1;

        // Если позиция больше чем есть треков
        if (position > queue.tracks.total) {
            // Переключаем на 0 позицию
            queue.tracks.position = 0;

            // Переключаемся на первый трек
            queue.player.play(0, 0, queue.tracks.position).catch(console.error);
        }

        else {
            // Переключаемся вперед
            queue.player.play(0, 0, position).catch(console.error);
        }

        // Уведомляем пользователя о пропущенном треке
        return ctx.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "player.button.skip"),
                    color: Colors.Green
                }
            ]
        });
    };
}