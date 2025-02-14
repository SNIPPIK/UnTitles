import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {Assign} from "@utils";

/**
 * @author SNIPPIK
 * @description Управление временем, дает возможность пропускать время в треке
 * @class SeekTrackCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "seek",
        "ru": "переход"
    },
    descriptions: {
        "en-US": "Jump to a specific track time!",
        "ru": "Переход к конкретному времени трека!"
    },
    dm_permission: false,
    options: [
        {
            type: ApplicationCommandOptionType["String"],
            names: {
                "en-US": "time",
                "ru": "время"
            },
            descriptions: {
                "en-US": "It is necessary to specify what time to arrive. Example - 00:00",
                "ru": "Необходимо указать к какому времени прейти. Пример - 00:00"
            },
            required: true,
        }
    ]
})
class SeekTrackCommand extends Assign<Command> {
    public constructor() {
        super({
            rules: ["queue", "voice", "another_voice", "player-not-playing"],
            execute: ({message, args}) => {
                const queue = message.queue;
                const duration = args[0]?.duration();

                //Если пользователь написал что-то не так
                if (isNaN(duration)) {
                    message.fastBuilder = {
                        color: Colors.DarkRed,
                        description: locale._(message.locale, "command.seek.duration.nan")
                    };
                    return;
                }

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.tracks.track.time.total) {
                    message.fastBuilder = {
                        color: Colors.DarkRed,
                        description: locale._(message.locale, "command.seek.duration.big")
                    };
                    return;
                }

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(duration);

                //Отправляем сообщение о пропуске времени
                message.fastBuilder = {
                    color: Colors.Green,
                    description: locale._(message.locale, "command.seek", [duration])
                };
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({SeekTrackCommand});