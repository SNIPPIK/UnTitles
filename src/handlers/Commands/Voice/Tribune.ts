import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/tools/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @author SNIPPIK
 * @description Управление голосовыми подключениями
 * @class VoiceCommand
 * @public
 */
class VoiceCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "tribune",
                    "ru": "трибуна"
                })
                .setDescription({
                    "en-US": "Interaction with voice connections",
                    "ru": "Взаимодействие с подключением к трибуне"
                })
                .addSubCommands([
                    {
                        names: {
                            "en-US": "stage",
                            "ru": "состояние"
                        },
                        descriptions: {
                            "en-US": "Request to broadcast music to the podium!",
                            "ru": "Запрос на транслирование музыки в трибуну!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                names: {
                                    "en-US": "choice",
                                    "ru": "выбор"
                                },
                                descriptions: {
                                    "en-US": "Options for interacting with the stands!",
                                    "ru": "Варианты взаимодействия с трибунами"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: [
                                    {
                                        name: "join - Connecting to the podium",
                                        nameLocalizations: {
                                            "ru": "join - Подключение к трибуне"
                                        },
                                        value: "join"
                                    },
                                    {
                                        name: "request - Connection request",
                                        nameLocalizations: {
                                            "ru": "request - Запрос на подключение"
                                        },
                                        value: "request"
                                    }
                                ]
                            }
                        ]
                    }
                ]),
            rules: ["voice", "another_voice"],
            execute: async ({message, args, type}) => {
                const me = message.guild.members?.me;

                switch (type) {
                    // Состояние
                    case "stage": {
                        try {
                            // Если бота просят подключится
                            if (args[0] === "join") await me.voice.setSuppressed(true);

                            // Если бота просят сделать запрос
                            else await me.voice.setRequestToSpeak(true);
                        } catch (err) {
                            // Если не удалось подключиться или сделать запрос
                            message.fastBuilder = {
                                description: args[0] === "join" ? locale._(message.locale, "voice.join.fail") : locale._(message.locale, "voice.join.request.fail"),
                                color: Colors.DarkRed
                            };
                            return;
                        }

                        // Если удалось подключиться или сделать запрос
                        message.fastBuilder = {
                            description: args[0] === "join" ? locale._(message.locale, "voice.join") : locale._(message.locale, "voice.join.request"),
                            color: Colors.Green
                        }
                        return;
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({VoiceCommand});