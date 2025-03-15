import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";
import * as process from "node:process";

@SlashCommand({
    names: {
        "en-US": "bot",
        "ru": "бот"
    },
    descriptions: {
        "en-US": "Managing bot!",
        "ru": "Управление ботом!"
    },
    dm_permission: false,
    options: [
        {
            names: {
                "en-US": "restart",
                "ru": "перезагрузка"
            },
            descriptions: {
                "en-US": "Reloading a Specific Item",
                "ru": "Перезагрузка конкретного элемента!"
            },
            type: ApplicationCommandOptionType["String"],
            choices: [
                {
                    value: "bot",
                    name: "bot",
                    nameLocalizations: {
                        "en-US": "bot",
                        "ru": "бот"
                    }
                },
                {
                    value: "commands",
                    name: "commands",
                    nameLocalizations: {
                        "en-US": "commands",
                        "ru": "команды"
                    }
                },
                {
                    value: "apis",
                    name: "apis",
                    nameLocalizations: {
                        "en-US": "apis",
                        "ru": "apis"
                    }
                },
                {
                    value: "events",
                    name: "events",
                    nameLocalizations: {
                        "en-US": "events",
                        "ru": "события"
                    }
                }
            ]
        },
    ]
})
class bot extends Assign<Command> {
    public constructor() {
        super({
            owner: true,
            execute: async ({message, args, type}) => {
                switch (type) {
                    case "restart": {
                        // Перезагружаем все команды
                        if (args[0] === "commands") {
                            db.commands.preregister(message.guild.members.client);

                            message.FBuilder = {
                                description: locale._(message.locale, `commands.reload`, [db.commands.public.length]),
                                color: Colors.Green
                            }
                        }

                        // Перезагрузка всех событий
                        else if (args[0] === "events") {
                            db.events.preregister(message.guild.members.client);

                            message.FBuilder = {
                                description: locale._(message.locale, `events.reload`, [db.events.events.length]),
                                color: Colors.Green
                            }
                        }

                        // Перезагрузка всех платформ
                        else if (args[0] === "apis") {
                            db.api.preregister();

                            message.FBuilder = {
                                description: locale._(message.locale, `apis.reload`, [db.api.platforms.supported.length]),
                                color: Colors.Green
                            };
                        }

                        // Перезагрузка бота (работает только в ShardManager)
                        else if (args[0] === "bot") {
                            message.FBuilder = {
                                description: locale._(message.locale, `bot.reload`, [message.author]),
                                color: Colors.Green
                            };

                            process.exit(0);
                        }
                        break;
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({bot});