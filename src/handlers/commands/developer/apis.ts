import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {API} from "@handler/apis";
import {Assign} from "@utils";
import {db} from "@app";

@SlashCommand({
    names: {
        "en-US": "api",
        "ru": "api"
    },
    descriptions: {
        "en-US": "Managing API work inside the bot!",
        "ru": "Управление системой APIs внутри бота!"
    },
    dm_permission: false,
    options: [
        {
            names: {
                "en-US": "access",
                "ru": "доступ"
            },
            descriptions: {
                "en-US": "Actions with the platform!",
                "ru": "Управление доступом к платформам!"
            },
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    names: {
                        "en-US": "choice",
                        "ru": "выбор"
                    },
                    descriptions: {
                        "en-US": "You must choose an action! What will we do with the platform?",
                        "ru": "Необходимо выбрать действие! Что будем делать с платформой?"
                    },
                    required: true,
                    type: ApplicationCommandOptionType["String"],
                    choices: [
                        {
                            name: "block - Block access",
                            nameLocalizations: {
                                "ru": "block - Заблокировать доступ"
                            },
                            value: "block"
                        },
                        {
                            name: "unblock - Unlock access",
                            nameLocalizations: {
                                "ru": "unblock - Разблокировать доступ"
                            },
                            value: "unblock"
                        }
                    ]
                },
                {
                    names: {
                        "en-US": "platform",
                        "ru": "платформа"
                    },
                    descriptions: {
                        "en-US": "Actions with the platform!",
                        "ru": "Необходимо выбрать платформу!"
                    },
                    required: true,
                    type: ApplicationCommandOptionType["String"],
                    choices: db.api.allow.map((platform) => {
                        return {
                            name: `[${platform.requests.length}] - ${platform.name} | ${platform.url}`,
                            value: platform.name
                        }
                    }),
                }
            ]
        }
    ]
})
class apis extends Assign<Command> {
    public constructor() {
        super({
            owner: true,
            execute: async ({message, args, type}) => {
                switch (type) {
                    case "access": {
                        if (args[0] === "block") {
                            // Если платформа уже заблокирована
                            if (db.api.platforms.block.includes(args[1] as API["name"])) {
                                message.FBuilder = {
                                    description: locale._(message.locale, "command.api.block.retry", [message.author]),
                                    color: Colors.Yellow
                                };
                                return;
                            }

                            // Блокируем платформу
                            db.api.platforms.block.push(args[1] as API["name"]);
                            message.FBuilder = {
                                description: locale._(message.locale, "command.api.block", [message.author]),
                                color: Colors.Green
                            };
                        } else if (args[0] === "unblock") {
                            // Если платформа не заблокирована
                            if (!db.api.platforms.block.includes(args[1] as API["name"])) {
                                message.FBuilder = {
                                    description: locale._(message.locale, "command.api.unblock.retry", [message.author]),
                                    color: Colors.Yellow
                                };
                                return;
                            }

                            // Разблокируем платформу
                            const index = db.api.platforms.block.indexOf(args[1] as API["name"]);
                            db.api.platforms.block.splice(index - 1, 1);
                            message.FBuilder = {
                                description: locale._(message.locale, "command.api.unblock", [message.author]),
                                color: Colors.Green
                            };
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
export default Object.values({ apis });