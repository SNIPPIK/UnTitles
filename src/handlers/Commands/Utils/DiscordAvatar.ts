import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @author SNIPPIK
 * @description Просмотр аватара пользователя
 * @class AvatarCommand
 * @public
 */
class AvatarCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "avatar",
                    "ru": "аватар"
                })
                .setDescription({
                    "en-US": "If you want to look at the user's avatar, I'm at your service!",
                    "ru": "Если хочется глянуть аватар пользователя я к вашим услугам!"
                })
                .addSubCommands([
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
                ]),
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
 * @description Делаем классы глобальными
 */
export default Object.values({AvatarCommand});