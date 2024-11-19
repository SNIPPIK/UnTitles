import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipTracksCommand
 */
class SkipTracksCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName({
                    "en-US": "skip",
                    "ru": "пропуск"
                })
                .setDescription({
                    "en-US": "Skip tracks to the specified track! The specified track will be current!",
                    "ru": "Пропуск треков до указанного трека! Указанный трек будет текущим!"
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
                ])
                .json,
            rules: ["voice", "another_voice", "queue"],
            execute: ({message, args}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const {player, tracks} = queue;
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                // Если пользователь укажет больше чем есть в очереди или меньше
                else if (arg > tracks.size || arg < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                const {title, url, color} = tracks.get(arg > 1 ? queue.tracks.position + arg - 1 : queue.tracks.position - 1);

                // Если аргумент больше 1, то ищем трек
                if (arg > 1) {
                    // Меняем позицию трека в очереди
                    queue.player.stop_fade(tracks.position + arg - 1);
                    message.fastBuilder = { description: locale._(message.locale, "command.skip.arg.track", [arg, `[${title}](${url})`]), color };

                    return;
                }

                // Пропускаем текущий трек
                queue.player.stop_fade(tracks.position + 1);
                message.fastBuilder = { description: locale._(message.locale, "command.skip.one.track", [`[${title}](${url})`]), color };
                return;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Возврат к конкретному треку
 * @class BackTrackCommand
 */
class BackTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName({
                    "en-US": "back",
                    "ru": "назад"
                })
                .setDescription({
                    "en-US": "Move current track to past",
                    "ru": "Переход от текущего трека к прошлому"
                })
                .addSubCommands([
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
                ])
                .json,
            rules: ["voice", "another_voice", "queue"],
            execute: ({message, args}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const {player, tracks} = queue;
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                // Если пользователь укажет больше чем есть в очереди или меньше
                else if (arg > tracks.size || arg < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                const {title, url, color} = tracks.get(arg > 1 ? arg : arg - 1);

                // Меняем позицию трека в очереди
                queue.player.stop_fade(arg);
                message.fastBuilder = { description: locale._(message.locale, "command.position", [arg, `[${title}](${url})`]), color };
                return;
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Удаление трека из очереди
 * @class RemoveTrackCommand
 */
class RemoveTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName({
                    "en-US": "remove",
                    "ru": "удалить"
                })
                .setDescription({
                    "en-US": "Deleting a track from the queue, without the possibility of recovery! Past tracks count!",
                    "ru": "Удаление трека из очереди, без возможности восстановить! Прошлые треки идут в счет!"
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
                ])
                .json,
            rules: ["voice", "another_voice", "queue"],
            execute: ({message, args}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (arg > queue.tracks.size || arg < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                let {title, color, url} = queue.tracks.get(arg - 1);

                // Удаляем трек указанный пользователем
                if (arg !== 1) queue.tracks.remove(arg - 1);
                else {
                    queue.player.stop_fade(queue.tracks.position + 1);
                    queue.tracks.remove(arg - 1);
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
export default Object.values({SkipTracksCommand, BackTrackCommand, RemoveTrackCommand});