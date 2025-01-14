import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/tools/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipUtilityCommand
 * @public
 */
class SkipUtilityCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "skip",
                    "ru": "пропуск"
                })
                .setDescription({
                    "en-US": "Skip tracks to the specified track! The specified track will be current!",
                    "ru": "Универсальная команда для управления позицией трека!"
                })
                .addSubCommands([
                    {
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
                    },
                    {
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
                    },
                    {
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
                    }
                ]),
            rules: ["voice", "another_voice", "queue", "player-not-playing"],
            execute: ({message, args, type}) => {
                const number = args.length > 0 ? parseInt(args.pop()) : 1;
                const {player, tracks} = db.audio.queue.get(message.guild.id);

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                switch (type) {
                    // Переключение текущий позиции назад
                    case "back": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.size || number < 1) {
                            message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                            return;
                        }

                        const {title, url, color} = tracks.get(number > 1 ? number : number - 1);

                        // Меняем позицию трека в очереди
                        player.stop(number - 1);
                        message.fastBuilder = { description: locale._(message.locale, "command.position", [number, `[${title}](${url})`]), color };
                        return;
                    }

                    // Переключение текущий позиции в любую сторону
                    case "to": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.total || number < 1) {
                            message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                            return;
                        }

                        const {title, url, color} = tracks.get(number - 1);

                        // Пропускаем текущий трек
                        player.stop(number - 1);
                        message.fastBuilder = { description: locale._(message.locale, "command.go.track", [`[${title}](${url})`]), color };
                        return;
                    }

                    // Переключение текущий позиции вперед
                    case "next": {
                        // Если пользователь укажет больше чем есть в очереди или меньше
                        if (number > tracks.size || number < 1) {
                            message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                            return;
                        }

                        const {title, url, color} = tracks.get(number - 1);

                        // Если аргумент больше 1, то ищем трек
                        if (number > 1) {
                            // Меняем позицию трека в очереди
                            player.stop(tracks.position + number - 1);
                            message.fastBuilder = { description: locale._(message.locale, "command.skip.arg.track", [number, `[${title}](${url})`]), color };

                            return;
                        }

                        // Пропускаем текущий трек
                        player.stop(tracks.position + 1);
                        message.fastBuilder = { description: locale._(message.locale, "command.skip.one.track", [`[${title}](${url})`]), color };
                        return;
                    }
                }
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Удаление трека из очереди
 * @class RemoveTrackCommand
 * @public
 */
class RemoveTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "remove",
                    "ru": "удалить"
                })
                .setDescription({
                    "en-US": "Deleting a track from the queue, without the possibility of recovery!",
                    "ru": "Удаление трека из очереди, без возможности восстановить!"
                })
                .addSubCommands([
                    {
                        type: ApplicationCommandOptionType["Number"],
                        required: true,
                        names: {
                            "en-US": "value",
                            "ru": "число"
                        },
                        descriptions: {
                            "en-US": "Number track in queue!",
                            "ru": "Номер трека!"
                        }
                    }
                ]),
            rules: ["voice", "another_voice", "queue", "player-not-playing"],
            execute: ({message, args}) => {
                const queue = db.audio.queue.get(message.guild.id);
                const number = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (number > queue.tracks.size || number < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                let {title, color, url} = queue.tracks.get(number - 1);

                // Удаляем трек указанный пользователем
                if (number !== 1) queue.tracks.remove(number - 1);
                else {
                    queue.player.stop(queue.tracks.position + 1);
                    queue.tracks.remove(number - 1);
                }

                message.fastBuilder = { description: locale._(message.locale, "command.remove.track", [`[${title}](${url})`]), color };
                return;
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({SkipUtilityCommand, RemoveTrackCommand});