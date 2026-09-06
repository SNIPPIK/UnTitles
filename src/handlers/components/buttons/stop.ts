import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import { Colors } from "#structures/discord/index.js";
import { MessageFlags } from 'seyfert/lib/types/index.js';
import { locale } from "#structures";
import { db } from "#db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "stop";
    }
    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);

        // Если есть очередь, то удаляем ее
        if (queue) queue.cleanup();

        return ctx.write({
            embeds: [{
                description: locale._(ctx.interaction.locale, "player.button.stop"),
                color: Colors.Green,
            }],
            flags: MessageFlags.Ephemeral
        });
    };
}