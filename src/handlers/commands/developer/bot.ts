import {Command, SlashCommand, SlashCommandSubCommand} from "@handler/commands";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app/db";

/**
 * @author SNIPPIK
 * @description Управление системами бота
 * @class WorkBotCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "bot",
        "ru": "бот"
    },
    descriptions: {
        "en-US": "Managing bot!",
        "ru": "Управление ботом!"
    },
    dm_permission: false
})
@SlashCommandSubCommand({
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
                "ru": "платформы"
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
class WorkBotCommand extends Assign<Command> {
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
                        db.commands.preregister(message.guild.members.client);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `commands.reload`, [db.commands.public.length]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Перезагрузка всех событий
                    case "events": {
                        db.events.preregister(message.guild.members.client);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `events.reload`, [db.events.events.length]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Перезагрузка всех платформ
                    case "apis": {
                        db.api.preregister();

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `apis.reload`, [db.api.platforms.supported.length]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Перезагрузка бота, правильно работает только с ShardManager
                    case "bot": {
                        // Время самого долгого трека из всех очередей
                        const timeout = db.queues.waitReboot + 200;

                        // Ожидаем выключения музыки на других серверах
                        setTimeout(async () => {
                            // Уничтожаем процесс
                            process.exit(0);
                        }, timeout);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, `bot.reload`, [message.member]),
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
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "bot-profile",
        "ru": "бот-профиль"
    },
    descriptions: {
        "en-US": "Manage profile bot!",
        "ru": "Управление профилем бота!"
    },
    dm_permission: false
})
@SlashCommandSubCommand({
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
class ManageBotCommand extends Assign<Command> {
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