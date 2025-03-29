import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {Assign} from "@utils";

/**
 * @author SNIPPIK
 * @description Удаление трека из очереди
 * @class RemoveTrackCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "remove",
        "ru": "удалить"
    },
    descriptions: {
        "en-US": "Deleting a track from the queue, without the possibility of recovery!",
        "ru": "Удаление трека из очереди, без возможности восстановить!"
    },
    dm_permission: false,
    options: [
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
    ]
})
class RemoveTrackCommand extends Assign<Command> {
    public constructor() {
        super({
            rules: ["voice", "another_voice", "queue", "player-not-playing"],
            execute: async ({message, args}) => {
                const queue = message.queue;
                const number = parseInt(args[0]) - 1;

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.FBuilder = {
                        description: locale._(message.locale, "command.seek.duration.nan"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (number > queue.tracks.total || number < 0) {
                    message.FBuilder = {
                        description: locale._(message.locale, "command.seek.duration.big"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                const {name, api, url} = queue.tracks.get(number);

                // Если выбран текущий трек
                if (number === queue.tracks.position) queue.player.stop(queue.tracks.position + 1);

                // Удаляем трек и очереди
                queue.tracks.remove(number);

                message.FBuilder = {
                    description: locale._(message.locale, "command.remove.track", [`[${name}](${url})`]),
                    color: api.color
                };
                return;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({RemoveTrackCommand});