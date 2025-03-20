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
                const number = args.length > 0 ? parseInt(args.pop()) : 1;

                // Если аргумент не является числом
                if (isNaN(number)) {
                    message.FBuilder = {
                        description: locale._(message.locale, "command.seek.duration.nan"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                // Если аргумент больше кол-ва треков
                else if (number > queue.tracks.size || number < 1) {
                    message.FBuilder = {
                        description: locale._(message.locale, "command.seek.duration.big"),
                        color: Colors.DarkRed
                    };
                    return;
                }

                let {name, api, url} = queue.tracks.get(number - 1);

                // Удаляем трек указанный пользователем
                if (number !== 1) queue.tracks.remove(number - 1);
                else {
                    queue.player.stop(queue.tracks.position + 1);
                    queue.tracks.remove(number - 1);
                }

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