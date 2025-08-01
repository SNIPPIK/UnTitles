import { CommandDeclare, CommandOptions, BaseCommand } from "#handler/commands";
import { ApplicationCommandOptionType, MessageFlags, User } from "discord.js";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Просмотр аватара пользователя
 * @class AvatarCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "avatar",
        "ru": "аватар"
    },
    descriptions: {
        "en-US": "If you need to take a closer look at the user's avatar!",
        "ru": "Если надо глянуть аватар пользователя поближе!"
    },
    integration_types: ["GUILD_INSTALL", "USER_INSTALL"],
    contexts: ["GUILD", "BOT_DM", "PRIVATE_CHANNEL"]
})
@CommandOptions({
    names: {
        "en-US": "user",
        "ru": "пользователь"
    },
    descriptions: {
        "en-US": "Specify the user!",
        "ru": "Укажи пользователя!"
    },
    type: ApplicationCommandOptionType["User"],
    required: true,
})
class AvatarCommand extends Assign< BaseCommand<User> > {
    public constructor() {
        super({
            permissions: {
                client: ["ViewChannel", "SendMessages"]
            },
            execute: async ({message, args}) => {
                const user = args[0];
                const me = message.client.user;
                const avatar = user.avatar ? user.avatarURL({size: 1024, forceStatic: false}) : db.images.no_image;

                // Отправляем сообщение в текстовый канал
                return message.reply({
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
                            description: `${locale._(message.locale, "user")} <@!${user.id}>`,
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
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [AvatarCommand];