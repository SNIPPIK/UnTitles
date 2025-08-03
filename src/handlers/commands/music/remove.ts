import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Assign, locale } from "#structures";
import { db } from "#app/db";
import {Colors} from "#structures/discord";

/**
 * @author SNIPPIK
 * @description Удаление трека из очереди
 * @class RemoveTrackCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "remove",
        "ru": "удалить"
    },
    descriptions: {
        "en-US": "Deleting a track from the queue, without the possibility of recovery!",
        "ru": "Удаление трека из очереди, без возможности восстановить!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    type: ApplicationCommandOptionType["Number"],
    required: true,
    autocomplete: true,
    names: {
        "en-US": "value",
        "ru": "число"
    },
    descriptions: {
        "en-US": "Number track in queue!",
        "ru": "Номер трека!"
    }
})
class RemoveTrackCommand extends Assign< BaseCommand<number> > {
    public constructor() {
        super({
            permissions: {
                client: ["SendMessages", "ViewChannel"]
            },
            middlewares: ["voice", "another_voice", "queue", "player-not-playing"],
            autocomplete: ({message, args}) => {
                const number = args[0];
                const queue = db.queues.get(message.guildId);
                if (!queue || isNaN(number) || number <= 0) return null;

                const total = queue.tracks.total;
                const maxSuggestions = 5;
                const index = number - 1;

                if (index < 0 || index >= total) return null;

                const half = Math.floor(maxSuggestions / 2);
                let startIndex = Math.max(0, index - half);

                // Корректируем старт, чтобы не выходить за пределы массива
                if (startIndex + maxSuggestions > total) {
                    startIndex = Math.max(0, total - maxSuggestions);
                }

                const tracks = queue.tracks.array(maxSuggestions, startIndex);
                const highlightIndex = index - startIndex;

                const results = tracks.map((track, i) => ({
                    name: `${startIndex + i + 1}. ${i === highlightIndex ? "🗑️" : "🎶"} (${track.time.split}) ${track.name.slice(0, 120)}`,
                    value: startIndex + i
                }));

                return message.respond(results);
            },
            execute: async ({message, args}) => {
                const queue = db.queues.get(message.guildId);
                const number = args[0];
                const track = queue.tracks.get(number);

                // Если указан трек которого нет
                if (!track) {
                    return message.reply({
                        embeds: [
                            {
                                description: locale._(message.locale, "command.remove.track.fail", [message.member]),
                                color: Colors.DarkRed
                            }
                        ],
                        flags: "Ephemeral"
                    });
                }

                const {name, url, api} = track;

                // Удаляем трек и очереди
                queue.tracks.remove(number);

                // Если выбран текущий трек
                if ((number - 1) === queue.tracks.position) {
                    // Если треков нет в очереди
                    if (!queue.tracks.total) return queue.cleanup();
                    await queue.player.play(0, 0, queue.tracks.position);
                }

                return message.reply({
                    embeds: [
                        {
                            description: locale._(message.locale, "command.remove.track", [`[${name}](${url})`]),
                            color: api.color
                        }
                    ],
                    flags: "Ephemeral"
                });
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ RemoveTrackCommand ];