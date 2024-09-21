import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";
import {locale} from "@lib/locale";

/**
 * @class Command_Seek
 * @command seek
 * @description Пропуск времени в текущем треке
 *
 * @param value - Время для пропуска времени
 */
class Command_Seek extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("seek")
                .setDescription("Пропуск времени в текущем треке!")
                .setDescriptionLocale({
                    "en-US": "Skipping the time in the current track!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Пример - 00:00",
                        descriptionLocalizations: {
                            "en-US": "Example - 00:00"
                        },
                        required: true,
                        type: ApplicationCommandOptionType["String"]
                    }
                ]).json,
            rules: ["queue", "voice", "anotherVoice"],
            execute: ({message, args}) => {
                const {author, guild} = message;
                const queue = db.audio.queue.get(guild.id);
                const duration = args[0]?.duration();

                //Если пользователь не указал время
                if (!duration) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration") }
                    return;
                }

                //Если пользователь написал что-то не так
                else if (isNaN(duration)) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.nan") }
                    return;
                }

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.songs.song.duration.seconds) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.big") }
                    return;
                }

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "player.playing.off") }
                    return;
                }

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(queue.songs.song, duration);

                //Отправляем сообщение о пропуске времени
                message.fastBuilder = { color: Colors.Green, description: locale._(message.locale, "command.seek", [duration]) }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Seek});