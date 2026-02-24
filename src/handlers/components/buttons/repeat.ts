import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import { Colors } from "#structures/discord";
import { RepeatType } from "#core/queue";
import { locale } from "#structures";
import { db } from "#app/db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId.startsWith("repeat");
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId), loop = queue.tracks.repeat;

        // Включение всех треков
        if (loop === RepeatType.None) {
            queue.tracks.repeat = RepeatType.Songs;

            return ctx.write({
                embeds: [{
                    description: locale._(ctx.interaction.locale, "player.button.repeat.songs"),
                    color: Colors.Green
                }],
                flags: MessageFlags.Ephemeral
            });
        }

        // Включение повтора трека
        else if (loop === RepeatType.Songs) {
            queue.tracks.repeat = RepeatType.Song;
            return ctx.write({
                embeds: [{
                    description: locale._(ctx.interaction.locale, "player.button.repeat.song"),
                    color: Colors.Green
                }],
                flags: MessageFlags.Ephemeral
            });
        }

        queue.tracks.repeat = RepeatType.None;
        return ctx.write({
            embeds: [{
                description: locale._(ctx.interaction.locale, "player.button.repeat.off"),
                color: Colors.Green
            }],
            flags: MessageFlags.Ephemeral
        });
    };
}