import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";

/**
 * @class Command_Voice
 * @command voice
 * @description Управление голосовыми подключениями
 */
class Command_Voice extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("tribune")
                .setDescription("Взаимодействие с подключением к трибуне")
                .setDescriptionLocale({
                    "en-US": "Interaction with voice connections"
                })
                .addSubCommands([
                    {
                        name: "stage",
                        description: "Запрос на транслирование музыки в трибуну!",
                        descriptionLocalizations: {
                            "en-US": "Request to broadcast music to the podium!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "choice",
                                description: "Варианты взаимодействия с трибунами!",
                                descriptionLocalizations: {
                                    "en-US": "Options for interacting with the stands!"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"],
                                choices: [
                                    {
                                        name: "join - Подключение к трибуне",
                                        nameLocalizations: {
                                            "en-US": "join - Connecting to the podium"
                                        },
                                        value: "join"
                                    },
                                    {
                                        name: "request - Запрос на подключение",
                                        nameLocalizations: {
                                            "en-US": "request - Connection request"
                                        },
                                        value: "request"
                                    }
                                ]
                            }
                        ]
                    }
                ]).json,
            rules: ["voice", "anotherVoice"],
            execute: async ({message, args, type}) => {
                const me = message.guild.members?.me;

                switch (type) {
                    case "stage": {
                        try {
                            if (args[0] === "join") await me.voice.setSuppressed(true);
                            else await me.voice.setRequestToSpeak(true);
                        } catch (err) {
                            message.fastBuilder = {
                                description: args[0] === "join" ? locale._(message.locale, "voice.join.fail") : locale._(message.locale, "voice.join.request.fail"),
                                color: Colors.DarkRed
                            };
                            return;
                        }

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
export default Object.values({Command_Voice});