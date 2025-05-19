import {Command, SlashCommand, SlashCommandSubCommand} from "@handler/commands";
import {ApplicationCommandOptionType, MessageFlags} from "discord.js";
import {locale} from "@service/locale";
import {Assign} from "@utils";

/**
 * @author SNIPPIK
 * @description Просмотр аватара пользователя
 * @class AvatarCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "avatar",
        "ru": "аватар"
    },
    descriptions: {
        "en-US": "If you need to take a closer look at the user's avatar!",
        "ru": "Если надо глянуть аватар пользователя поближе!"
    },
    dm_permission: false
})
@SlashCommandSubCommand({
    names: {
        "en-US": "user",
        "ru": "пользователь"
    },
    descriptions: {
        "en-US": "Specify the user!",
        "ru": "Укажи пользователя!"
    },
    type: ApplicationCommandOptionType["User"],
    required: true
})
class AvatarCommand extends Assign<Command> {
    public constructor() {
        super({
            permissions: {
                client: ["ViewChannel", "SendMessages"]
            },
            execute: async ({message, args}) => {
                const user = message.guild.members.cache.get(args[0]).user;
                const avatar = user.avatarURL({size: 1024, forceStatic: false});

                // Отправляем сообщение в текстовый канал
                return message.reply({
                    components:[
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
                                text: `${message.guild.members.me.user.username}`,
                                icon_url: message.guild.members.me.user.avatarURL({size: 1024, forceStatic: false})
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