import {ApplicationCommandOptionType} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
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
    dm_permission: false,
    options: [
        {
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
        }
    ]
})
class AvatarCommand extends Assign<Command> {
    public constructor() {
        super({
            execute: ({message, args}) => {
                const user = message.guild.members.cache.get(args[0]).user;

                // Отправляем сообщение в текстовый канал
                new message.builder().addEmbeds([
                    {
                        color: user.accentColor,
                        description: `${locale._(message.locale, "user")} <@!${user.id}>`,
                        timestamp: new Date,
                        image: { url: user.avatarURL({size: 1024, forceStatic: false}) },
                        footer: {
                            text: `${message.me.user.username}`,
                            iconURL: message.me.user.avatarURL({size: 1024, forceStatic: false})
                        }
                    }
                ]).setTime(30e3).send = message;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({AvatarCommand});