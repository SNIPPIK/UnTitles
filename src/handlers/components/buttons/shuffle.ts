import { ComponentCommand, type ComponentContext } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import {locale} from "#structures";
import {db} from "#app/db";

export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "shuffle";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);

        // Если в очереди менее 2 треков
        if (queue.tracks.size < 2) {
            return ctx.write({
                embeds: [{
                    description: locale._(ctx.interaction.locale, "player.button.shuffle.fail"),
                    color: queue.tracks.track.api.color
                }],
                flags: MessageFlags.Ephemeral
            });
        }

        // Включение тасовки очереди
        queue.tracks.shuffleTracks(!queue.tracks.shuffle);

        // Отправляем сообщение о включении или выключении тасовки
        return ctx.write({
            embeds: [{
                description: locale._(ctx.interaction.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                color: queue.tracks.track.api.color
            }],
            flags: MessageFlags.Ephemeral
        });
    };
}