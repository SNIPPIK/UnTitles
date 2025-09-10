import { Declare, Command, CommandContext, Middlewares } from "#handler/commands";
import { ApplicationCommandType } from "discord-api-types/v10";
import { MessageFlags, User } from "discord.js";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Просмотр аватара пользователя
 * @class AvatarCommand
 * @extends Assign
 * @public
 */
@Declare({
    names: {
        "en-US": "Avatar",
        "ru": "Аватар"
    },
    integration_types: ["GUILD_INSTALL", "USER_INSTALL"],
    contexts: ["GUILD", "BOT_DM", "PRIVATE_CHANNEL"],
    type: ApplicationCommandType.User
})
@Middlewares(["cooldown"])
class AvatarContextCommand extends Command {
    public override run = ({ctx, args}: CommandContext<User>) => {
        const user = args[0];
        const me = ctx.client.user;
        const avatar = user.avatar ? user.avatarURL({size: 1024, forceStatic: false}) : db.images.no_image;

        // Отправляем сообщение в текстовый канал
        return ctx.reply({
            components: [
                {
                    type: 1,
                    components: [
                        {
                            "type": 2,
                            "label": "User",
                            "style": 5,
                            "url": `https://discordapp.com/users/${user.id}`
                        },
                        {
                            "type": 2,
                            "label": "Image",
                            "style": 5,
                            "url": avatar
                        },
                    ]
                }
            ],
            embeds: [
                {
                    color: user.accentColor,
                    description: `${locale._(ctx.locale, "user")} <@!${user.id}>`,
                    timestamp: new Date() as any,
                    image: { url: avatar },
                    footer: {
                        text: `${me.username}`,
                        icon_url: me.avatarURL({size: 1024, forceStatic: false})
                    }
                }
            ],
            flags: MessageFlags.Ephemeral
        })
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [AvatarContextCommand];