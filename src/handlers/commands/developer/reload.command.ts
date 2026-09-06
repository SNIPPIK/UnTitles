import { ApplicationIntegrationType, InteractionContextType, PermissionFlagsBits } from "seyfert/lib/types/index.js";
import { Command, type CommandContext, Declare, Locales } from "seyfert";
import { DeveloperOptions } from "#structures/utils/decorator.js";

@Declare({
    name: "reload",
    description: "Restarting the bot's internal systems! This does not affect music queues.",
    defaultMemberPermissions: [PermissionFlagsBits.ManageGuild, PermissionFlagsBits.Administrator],
    integrationTypes: [ApplicationIntegrationType.GuildInstall],
    contexts: [InteractionContextType.Guild],
})
@DeveloperOptions({ onlyDeveloper: true })
@Locales({
    name: [
        ["ru", "перезапуск"],
        ["en-US", "reload"]
    ],
    description: [
        ["ru", "Restarting the bot's internal systems! This does not affect music queues."],
        ["en-US", "Turning on music, or searching for music!"]
    ]
})
export default class ReloadCommand extends Command {
    public override async run(ctx: CommandContext): Promise<void> {
        await ctx.deferReply(true);
        await ctx.client
            .reload()
            .then((): Promise<void> => ctx.editOrReply({content: `\`✅\` ${ctx.client.me.username} has been reloaded.`}))
            .catch((): Promise<void> => ctx.editOrReply({content: "`❌` Something failed during the reload."}));
    }
}