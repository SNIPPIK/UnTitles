import { ComponentCommand, type ComponentContext } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import {RepeatType} from "#core/queue";
import {locale} from "#structures";
import {db} from "#app/db";

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
                    color: queue.tracks.track.api.color
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
                    color: queue.tracks.track.api.color
                }],
                flags: MessageFlags.Ephemeral
            });
        }

        queue.tracks.repeat = RepeatType.None;
        return ctx.write({
            embeds: [{
                description: locale._(ctx.interaction.locale, "player.button.repeat.off"),
                color: queue.tracks.track.api.color
            }],
            flags: MessageFlags.Ephemeral
        });
    };
}