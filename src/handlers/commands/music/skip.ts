import {Command, SlashCommand, SlashCommandSubCommand} from "@handler/commands";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipUtilityCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "skip",
        "ru": "пропуск"
    },
    descriptions: {
        "en-US": "Skip tracks to the specified track! The specified track will be current!",
        "ru": "Универсальная команда для управления позицией трека!"
    },
    dm_permission: false
})
@SlashCommandSubCommand({
    names: {
        "en-US": "back",
        "ru": "назад"
    },
    descriptions: {
        "en-US": "Move current track to past!",
        "ru": "Переход от текущего трека к прошлому!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            type: ApplicationCommandOptionType["Number"]
        }
    ]
})
@SlashCommandSubCommand({
    names: {
        "en-US": "to",
        "ru": "на"
    },
    descriptions: {
        "en-US": "Go to the specified track!",
        "ru": "Переход к указанному треку!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            type: ApplicationCommandOptionType["Number"]
        }
    ]
})
@SlashCommandSubCommand({
    names: {
        "en-US": "next",
        "ru": "вперед"
    },
    descriptions: {
        "en-US": "Skip tracks to the specified track!",
        "ru": "Пропуск треков до указанного трека!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            type: ApplicationCommandOptionType["Number"]
        }
    ]
})
class SkipUtilityCommand extends Assign<Command> {
    public constructor() {
        super({
            permissions: {
                client: ["ViewChannel", "SendMessages"]
            },
            rules: ["voice", "another_voice", "queue", "player-not-playing"],
            execute: async ({message, args, type}) => {
                const number = args.length > 0 ? parseInt(args.pop()) : 1;
                const {player, tracks} = db.queues.get(message.guild.id);

                // Если аргумент не является числом
                if (isNaN(number)) {
                    return message.reply({
                        embeds: [
                            {
                                description: locale._(message.locale, "command.seek.duration.nan"),
                                color: Colors.DarkRed
                            }
                        ],
                        flags: "Ephemeral"
                    });
                }

                switch (type) {
                    // Переключение текущий позиции назад
                    case "back": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.size || number < 1) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.seek.duration.big"),
                                        color: Colors.DarkRed
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        const {name, url, api} = tracks.get(number > 1 ? number : number - 1);

                        // Меняем позицию трека в очереди
                        player.stop(number - 1);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.position", [number, `[${name}](${url})`]),
                                    color: api.color
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Переключение текущий позиции в любую сторону
                    case "to": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.total || number < 1) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.seek.duration.big"),
                                        color: Colors.DarkRed
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        const {name, url, api} = tracks.get(number - 1);

                        // Пропускаем текущий трек
                        player.stop(number - 1);

                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.go.track", [`[${name}](${url})`]),
                                    color: api.color
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Переключение текущий позиции вперед
                    case "next": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.size || number < 1) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.seek.duration.big"),
                                        color: Colors.DarkRed
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        const {name, url, api} = tracks.get(number - 1);

                        // Если аргумент больше 1, то ищем трек
                        if (number > 1) {
                            // Меняем позицию трека в очереди
                            player.stop(tracks.position + number - 1);
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.skip.arg.track", [number, `[${name}](${url})`]),
                                        color: api.color
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Пропускаем текущий трек
                        player.stop(tracks.position + 1);
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.skip.one.track", [`[${name}](${url})`]),
                                    color: api.color
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
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [SkipUtilityCommand];