import { BaseCommand, SlashCommand, SlashCommandSubCommand } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { locale } from "#service/locale";
import { Assign } from "#structures";
import { db } from "#app/db";

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
    integration_types: ["GUILD_INSTALL"]
})
@SlashCommandSubCommand({
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
                let start = index - half;
                let end = index + half;

                if (start < 0) {
                    end += Math.abs(start);
                    start = 0;
                }
                if (end >= total) {
                    const overshoot = end - (total - 1);
                    start = Math.max(0, start - overshoot);
                    end = total - 1;
                }

                const results = [];
                for (let i = start; i <= end; i++) {
                    const track = queue.tracks.get(i);
                    if (!track) continue;

                    const isTarget = i === index;
                    results.push({
                        name: `${i + 1}. ${isTarget ? "🗑️" : "🎶"} (${track.time.split}) ${track.name.slice(0, 120)}`,
                        value: i
                    });
                }

                return message.respond(results);
            },
            execute: async ({message, args}) => {
                const queue = db.queues.get(message.guild.id);
                const number = args[0];
                const track = queue.tracks.get(number);

                // Если указан трек которого нет
                if (!track) return null;

                const {name, url, api} = track;

                // Удаляем трек и очереди
                queue.tracks.remove(number);

                // Если выбран текущий трек
                if (number === queue.tracks.position) {
                    // Если треков нет в очереди
                    if (!queue.tracks.total) return queue.cleanup();
                    queue.player.stop(queue.tracks.position);
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
export default [RemoveTrackCommand];