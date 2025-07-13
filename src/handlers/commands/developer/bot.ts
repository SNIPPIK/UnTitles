import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Colors } from "#structures/discord";
import { locale } from "#service/locale";
import { Assign } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление системами бота
 * @class WorkBotCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "bot",
        "ru": "бот"
    },
    descriptions: {
        "en-US": "Managing bot!",
        "ru": "Управление ботом!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
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
            value: "events",
            name: "events",
            nameLocalizations: {
                "en-US": "events",
                "ru": "события"
            }
        }
    ]
})
class WorkBotCommand extends Assign< BaseCommand > {
    public constructor() {
        super({
            owner: true,
            permissions: {
                client: ["SendMessages"]
            },
            execute: async ({message, args}) => {
                // Варианты перезагрузки (аргументы)
                switch (args[0]) {
                    // Перезагружаем все команды
                    case "commands": {
                        db.commands.register(message.guild.members.client);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `has.reload`, [db.commands.size]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Перезагрузка всех событий
                    case "events": {
                        db.events.register(message.guild.members.client);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `has.reload`, [db.events.size]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Перезагрузка бота, правильно работает только с ShardManager
                    case "bot": {
                        // Запускаем перезапуск, по истечению времени последнего плеера будет включение нового процесса
                        process.emit("SIGINT");

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `self.reload`, [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }
                }
                return null;
            }
        });
    };
}


/**
 * @author SNIPPIK
 * @description Управление профилем бота
 * @class ManageBotCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "bot-profile",
        "ru": "бот-профиль"
    },
    descriptions: {
        "en-US": "Manage profile bot!",
        "ru": "Управление профилем бота!"
    }
})
@CommandOptions({
    names: {
        "en-US": "avatar",
        "ru": "аватар"
    },
    descriptions: {
        "en-US": "Change avatar a bot",
        "ru": "Изменение аватара бота!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "file",
                "ru": "файл"
            },
            descriptions: {
                "en-US": "New avatar, needed a file!",
                "ru": "Смена аватара, необходим файл!"
            },
            type: ApplicationCommandOptionType.Attachment,
            required: true
        }
    ]
})
class ManageBotCommand extends Assign< BaseCommand > {
    public constructor() {
        super({
            owner: true,
            permissions: {
                client: ["SendMessages"]
            },
            execute: async ({message, type}) => {
                // Варианты команд (доп команд)
                switch (type) {
                    case "avatar": {
                        const attachment = message.options.getAttachment("file");
                        const client = message.client;

                        //Если попытка всунуть не изображение
                        if (!attachment.contentType.match(/image/)) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.bot.avatar.image.fail"),
                                        color: Colors.Yellow
                                    }
                                ]
                            });
                        }

                        client.user.setAvatar(attachment.url)
                            // Если удалось установить новый аватар
                            .then(async () => {
                                return message.reply({
                                    embeds: [
                                        {
                                            author: { name: client.user.username, icon_url: client.user.avatarURL() },
                                            description: locale._(message.locale, "command.bot.avatar.ok"),
                                            color: Colors.Green
                                        }
                                    ]
                                });
                            })

                            // Если не удалось установить новый аватар
                            .catch(async (err) => {
                                return message.reply({
                                    embeds: [
                                        {
                                            author: { name: client.user.username, icon_url: client.user.avatarURL() },
                                            description: locale._(message.locale, "command.bot.avatar.fail", [err]),
                                            color: Colors.DarkRed
                                        }
                                    ]
                                });
                            });
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
export default [WorkBotCommand, ManageBotCommand];