import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipTracksCommand
 * @public
 */
class SkipTracksCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
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
                ]),
            rules: ["voice", "another_voice", "queue"],
            execute: ({message, args}) => {
                const number = args.length > 0 ? parseInt(args.pop()) : 1;
                const {player, tracks} = db.audio.queue.get(message.guild.id);

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                // Если пользователь укажет больше чем есть в очереди или меньше
                else if (number > tracks.size || number < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                const {title, url, color} = tracks.get(number > 1 ? tracks.position + number - 1 : tracks.position - 1);

                // Если аргумент больше 1, то ищем трек
                if (number > 1) {
                    // Меняем позицию трека в очереди
                    player.stop_fade(tracks.position + number - 1);
                    message.fastBuilder = { description: locale._(message.locale, "command.skip.arg.track", [number, `[${title}](${url})`]), color };

                    return;
                }

                // Пропускаем текущий трек
                player.stop_fade(tracks.position + 1);
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
 * @public
 */
class BackTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
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
                ]),
            rules: ["voice", "another_voice", "queue"],
            execute: ({message, args}) => {
                const queue = db.audio.queue.get(message.guild.id);
                const {player, tracks} = queue;
                const number = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.nan"), color: Colors.DarkRed };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                // Если пользователь укажет больше чем есть в очереди или меньше
                else if (number > tracks.size || number < 1) {
                    message.fastBuilder = { description: locale._(message.locale, "command.seek.duration.big"), color: Colors.DarkRed };
                    return;
                }

                const {title, url, color} = tracks.get(number > 1 ? number : number - 1);

                // Меняем позицию трека в очереди
                queue.player.stop_fade(number);
                message.fastBuilder = { description: locale._(message.locale, "command.position", [number, `[${title}](${url})`]), color };
                return;
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
                ]),
            rules: ["voice", "another_voice", "queue"],
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

                // Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
                    return;
                }

                let {title, color, url} = queue.tracks.get(number - 1);

                // Удаляем трек указанный пользователем
                if (number !== 1) queue.tracks.remove(number - 1);
                else {
                    queue.player.stop_fade(queue.tracks.position + 1);
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
export default Object.values({SkipTracksCommand, BackTrackCommand, RemoveTrackCommand});