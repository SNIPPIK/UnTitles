import { Command, CommandContext, Declare, Middlewares, Locales } from "seyfert";
import { ApplicationCommandType } from "seyfert/lib/types/index.js";
import { MessageFlags } from "discord-api-types/v10";
import { locale } from "#structures";

/**
 * @author SNIPPIK
 * @description Просмотр аватара пользователя
 * @class AvatarContextCommand
 * @extends Command
 * @public
 */
@Declare({
    name: "Avatar",
    type: ApplicationCommandType.User,
    integrationTypes: ["GuildInstall", "UserInstall"],
    botPermissions: ["SendMessages", "EmbedLinks"]
})
@Middlewares(["checkCooldown"])
@Locales({
    name: [
        ["ru", "Аватар"],
        ["en-US", "Avatar"]
    ],
    description: [
        ["ru", "Просмотр аватара пользователя"],
        ["en-US", "View user's avatar"]
    ]
})
export default class AvatarContextCommand extends Command {
    async run(ctx: CommandContext) {
        // В контекстной команде типа User целевой пользователь доступен через ctx.target
        const user = ctx.interaction.data.resolved.users[0];
        const me = ctx.client.me;
        const avatar = user.avatarURL({ size: 1024, forceStatic: false });

        // Отправляем эфемерный ответ
        await ctx.write({
            embeds: [
                {
                    color: user.accentColor,
                    description: `${locale._(ctx.interaction.locale, "user")} <@!${user.id}>`,
                    timestamp: new Date().toISOString(),
                    image: { url: avatar },
                    footer: {
                        text: me.username,
                        icon_url: me.avatarURL({ size: 1024, forceStatic: false }),
                    },
                },
            ],
            components: [
                {
                    type: 1,
                    components: [
                        {
                            type: 2,
                            label: "User",
                            style: 5,
                            url: `https://discordapp.com/users/${user.id}`,
                        },
                        {
                            type: 2,
                            label: "Image",
                            style: 5,
                            url: avatar,
                        },
                    ],
                },
            ],
            flags: MessageFlags.Ephemeral,
        });
    }
}