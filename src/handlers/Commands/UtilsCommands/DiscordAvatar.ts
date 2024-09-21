import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @class AvatarCommand
 * @command avatar
 * @description Просмотр аватара пользователя
 */
class AvatarCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("avatar")
                .setDescription("Если хочется глянуть аватар пользователя я к вашим услугам!")
                .setDescriptionLocale({
                    "en-US": "Если хочется глянуть аватар пользователя я к вашим услугам!"
                })
                .addSubCommands([
                    {
                        name: "user",
                        description: "Укажи пользователя!",
                        descriptionLocalizations: {
                            "en-US": "Need user!"
                        },
                        type: ApplicationCommandOptionType["User"],
                        required: true
                    }
                ])
                .json,
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