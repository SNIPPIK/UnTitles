import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class SkipTracksCommand
 * @command skip
 * @description Пропуск треков до указанного трека!
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
                    "en-US": "Skip tracks to the specified track!",
                    "ru": "Пропуск треков до указанного трека!"
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
            rules: ["voice", "anotherVoice", "queue"],
            execute: ({message, args}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const {player, songs} = queue;
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "command.seek.duration.nan"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!player.playing) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "player.playing.off"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если пользователь укажет больше чем есть в очереди или меньше
                else if (arg > songs.size && arg < songs.size) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "command.seek.duration.big"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                const {title, url, color} = songs.get(arg > 1 ? arg : arg - 1);

                // Если аргумент больше 1, то ищем трек
                if (arg > 1) {
                    // Меняем позицию трека в очереди
                    db.audio.queue.events.emit("request/time", queue, songs.position + arg);
                    message.fastBuilder = {
                        description: locale._(message.locale, "command.skip.arg.track", [arg, `[${title}](${url})`]),
                        color
                    };

                    return;
                }

                // Пропускаем текущий трек
                db.audio.queue.events.emit("request/time", queue, songs.position + 1);
                message.fastBuilder = {
                    description: locale._(message.locale, "command.skip.one.track", [`[${title}](${url})`]),
                    color
                };
                return;
            }
        });
    };
}

/**
 * @class RemoveTrackCommand
 * @command remove
 * @description Удаление трека из очереди
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
                ])
                .json,
            rules: ["voice", "anotherVoice", "queue"],
            execute: ({message, args}) => {
                const { guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "command.seek.duration.nan"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (arg > queue.songs.size && arg < queue.songs.size) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "command.seek.duration.big"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "player.playing.off"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                let {title, color, url} = queue.songs.get(arg - 1);

                // Удаляем трек указанный пользователем
                if (arg !== 1) queue.songs.remove(arg - 1);
                else {
                    db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);
                    queue.songs.remove(arg - 1);
                }

                message.fastBuilder = {
                    description: locale._(message.locale, "command.remove.track", [`[${title}](${url})`]),
                    color
                };
                return;
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({SkipTracksCommand, RemoveTrackCommand});