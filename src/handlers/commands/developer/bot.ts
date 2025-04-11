import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";

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
        },
    ]
})
class WorkBotCommand extends Assign<Command> {
    public constructor() {
        super({
            owner: true,
            execute: async ({message, type}) => {
                // Варианты команд (доп команд)
                switch (type) {
                    case "avatar": {
                        const attachment = message.options.getAttachment("file");
                        const embed = new message.builder().setTime(20e3);
                        const client = message.me.client;

                        //Если попытка всунуть не изображение
                        if (!attachment.contentType.match(/image/)) {
                            message.FBuilder = {
                                description: locale._(message.locale, "command.bot.avatar.image.fail"),
                                color: Colors.Yellow
                            }
                            return;
                        }

                        client.user.setAvatar(attachment.url)
                            // Если удалось установить новый аватар
                            .then(async () => {
                                embed.addEmbeds([
                                    {
                                        author: {name: client.user.username, iconURL: client.user.avatarURL()},
                                        description: locale._(message.locale, "command.bot.avatar.ok"),
                                        color: Colors.Green
                                    }
                                ]).send = message;
                            })

                            // Если не удалось установить новый аватар
                            .catch(async (err) => {
                                embed.addEmbeds([
                                    {
                                        author: {name: client.user.username, iconURL: client.user.avatarURL()},
                                        description: locale._(message.locale, "command.bot.avatar.fail", [err]),
                                        color: Colors.DarkRed
                                    }
                                ]).send = message;
                            });
                        break;
                    }
                }
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
    dm_permission: false,
    options: [
        {
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
        }
    ]
})
class ManageBotCommand extends Assign<Command> {
    public constructor() {
        super({
            owner: true,
            execute: async ({message, args}) => {
                // Варианты перезагрузки (аргументы)
                switch (args[0]) {
                    // Перезагружаем все команды
                    case "commands": {
                        db.commands.preregister(message.guild.members.client);

                        message.FBuilder = {
                            description: locale._(message.locale, `commands.reload`, [db.commands.public.length]),
                            color: Colors.Green
                        }
                        return;
                    }

                    // Перезагрузка всех событий
                    case "events": {
                        db.events.preregister(message.guild.members.client);

                        message.FBuilder = {
                            description: locale._(message.locale, `events.reload`, [db.events.events.length]),
                            color: Colors.Green
                        }
                        return;
                    }

                    // Перезагрузка всех платформ
                    case "apis": {
                        db.api.preregister();

                        message.FBuilder = {
                            description: locale._(message.locale, `apis.reload`, [db.api.platforms.supported.length]),
                            color: Colors.Green
                        };
                        return;
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

                        message.FBuilder = {
                            description: locale._(message.locale, `bot.reload`, [message.author]),
                            color: Colors.Green
                        };
                        return;
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
export default Object.values({WorkBotCommand, ManageBotCommand});