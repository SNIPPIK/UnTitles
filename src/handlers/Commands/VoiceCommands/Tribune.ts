import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {Constructor, Handler} from "@handler";
import {Voice} from "@lib/voice";

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
            execute: async ({message, args, type}) => {
                const { guild } = message;
                const me = message.guild.members?.me;

                switch (type) {
                    case "stage": {
                        const voiceConnection = Voice.get(guild.id);

                        try {
                            if (args[0] === "join") await me.voice.setSuppressed(true);
                            else await me.voice.setRequestToSpeak(true);
                        } catch (err) {
                            message.send({
                                embeds: [
                                    {
                                        description: args[0] === "join" ? "При подключении произошла ошибка!" : "При отправке запроса произошла ошибка"
                                    }
                                ]
                            });
                            return;
                        }

                        message.send({
                            embeds: [
                                {
                                    description: args[0] === "join" ? "Произведено подключение" : "Был отправлен запрос"
                                }
                            ]
                        })
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