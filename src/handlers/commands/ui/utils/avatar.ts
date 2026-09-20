import { Command, CommandContext, Declare, Middlewares, Locales } from "seyfert";
import { ApplicationCommandType } from "seyfert/lib/types/index.js";
import { Colors } from "#structures/discord/index.js";
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
        const user = Object.values(ctx.interaction.data.resolved.users)[0];
        const me = ctx.client.me;

        // Отправляем эфемерный ответ
        await ctx.write({
            embeds: [
                {
                    color: user?.accentColor ?? Colors.Navy,
                    description: `${locale._(ctx.interaction.locale, "user")} <@!${user.id}>`,
                    timestamp: new Date().toISOString(),
                    image: { url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=1024` },
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
                            url: `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=1024`,
                        },
                    ],
                },
            ],
            flags: MessageFlags.Ephemeral,
        });
    }
}