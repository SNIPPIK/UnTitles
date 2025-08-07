import { Command, CommandContext, Declare, Options } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { RestServerSide } from "#handler/rest";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление доступом к api системе
 * @class APISCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "api",
        "ru": "api"
    },
    descriptions: {
        "en-US": "Managing API work inside the bot!",
        "ru": "Управление системой APIs внутри бота!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@Options({
    api: {
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
})
class APISCommand extends Command {
    public execute({message, args}: CommandContext<string>) {
        if (args[0] === "block") {
            // Если платформа уже заблокирована
            if (db.api.platforms.block.includes(args[1] as RestServerSide.API["name"])) {
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
            db.api.platforms.block.push(args[1] as RestServerSide.API["name"]);
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
            if (!db.api.platforms.block.includes(args[1] as RestServerSide.API["name"])) {
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
            const index = db.api.platforms.block.indexOf(args[1] as RestServerSide.API["name"]);
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
        return null;
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [APISCommand];