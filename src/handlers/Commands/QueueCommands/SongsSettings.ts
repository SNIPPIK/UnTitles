import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
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
                const { author, member, guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = { description: "global.arg.NaN" };
                    return;
                }

                let {player, songs} = queue, {title} = queue.songs.get(arg - 1);

                try {
                    // Если музыку нельзя пропустить из-за плеера
                    if (!player.playing) {
                        message.fastBuilder = { description: "player.played.not" };
                        return;
                    }

                    // Если пользователь укажет больше чем есть в очереди или меньше
                    else if (arg > songs.size && arg < queue.songs.size) {
                        message.fastBuilder = { description: "command.control.skip.arg" };
                        return;
                    }

                    // Если аргумент больше 1, то ищем трек
                    if (arg > 1) {
                        // Меняем позицию трека в очереди
                        db.audio.queue.events.emit("request/time", queue, queue.songs.position + arg);
                        message.fastBuilder = { description: "command.skip.arg.track" };

                        return;
                    }

                    // Пропускаем текущий трек
                    db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);
                    message.fastBuilder = { description: "command.skip.one.track" };
                } catch (err) {
                    message.fastBuilder = {description: "error.retry"}
                }
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
                const { author, guild } = message;
                const queue = db.audio.queue.get(guild.id);
                const arg = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(arg)) {
                    message.fastBuilder = { description: "global.arg.NaN" };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (arg > queue.songs.size && arg < queue.songs.size) {
                    message.fastBuilder = { description: "command.control.skip.arg" };
                    return;
                }

                // Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { description: "player.played.not" };
                    return;
                }

                let {title} = queue.songs.get(arg - 1);

                // Удаляем трек указанный пользователем
                if (arg !== 1) queue.songs.remove(arg - 1);
                else {
                    db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);
                    queue.songs.remove(arg - 1);
                }

                message.fastBuilder = { description: `Remove track **${title}**` };
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