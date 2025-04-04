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
            execute: async ({message, args}) => {
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
export default Object.values({WorkBotCommand});