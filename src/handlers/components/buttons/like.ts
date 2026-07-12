import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import { Colors } from "#structures/discord/index.js";
import { MessageFlags } from "discord-api-types/v10";
import { locale } from "#structures";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "back";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "player.button.like"),
                    color: Colors.White
                }
            ]
        })
    };
}