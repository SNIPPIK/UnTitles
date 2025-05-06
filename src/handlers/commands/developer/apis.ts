import {Command, SlashCommand, SlashCommandSubCommand} from "@handler/commands";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {locale} from "@service/locale";
import {RestAPI} from "@handler/rest/apis";
import {Assign} from "@utils";
import {db} from "@app/db";

/**
 * @author SNIPPIK
 * @description Управление доступом к api системе
 * @class APISCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "api",
        "ru": "api"
    },
    descriptions: {
        "en-US": "Managing API work inside the bot!",
        "ru": "Управление системой APIs внутри бота!"
    },
    dm_permission: false
})
@SlashCommandSubCommand({
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
})
class APISCommand extends Assign<Command> {
    public constructor() {
        super({
            owner: true,
            permissions: {
                client: ["SendMessages"]
            },
            execute: async ({message, args, type}) => {
                switch (type) {
                    case "access": {
                        if (args[0] === "block") {
                            // Если платформа уже заблокирована
                            if (db.api.platforms.block.includes(args[1] as RestAPI["name"])) {
                                return message.reply({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "command.api.block.retry", [message.member]),
                                            color: Colors.Yellow
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }

                            // Блокируем платформу
                            db.api.platforms.block.push(args[1] as RestAPI["name"]);
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.api.block", [message.member]),
                                        color: Colors.Green
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }
                        else if (args[0] === "unblock") {
                            // Если платформа не заблокирована
                            if (!db.api.platforms.block.includes(args[1] as RestAPI["name"])) {
                                return message.reply({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "command.api.unblock.retry", [message.member]),
                                            color: Colors.Yellow
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }

                            // Разблокируем платформу
                            const index = db.api.platforms.block.indexOf(args[1] as RestAPI["name"]);
                            db.api.platforms.block.splice(index - 1, 1);

                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.api.unblock", [message.member]),
                                        color: Colors.Green
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }
                        break;
                    }
                }
                return null;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [APISCommand];