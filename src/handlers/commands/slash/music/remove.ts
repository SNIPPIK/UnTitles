import { Command, CommandCallback, Declare, Options, Permissions, Middlewares } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";


/**
 * @author SNIPPIK
 * @description Удаление трека из очереди
 * @class RemoveTracksCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "remove",
        "ru": "удалить"
    },
    descriptions: {
        "en-US": "Deleting a track from the queue, without the possibility of recovery!",
        "ru": "Удаление трека из очереди, без возможности восстановить!"
    }
})
@Options({
    remove: {
        names: {
            "en-US": "value",
            "ru": "число"
        },
        descriptions: {
            "en-US": "Number track in queue!",
            "ru": "Номер трека!"
        },
        type: ApplicationCommandOptionType.Number,
        required: true,
        autocomplete: ({ctx, args}) => {
            const number = args[0];
            const queue = db.queues.get(ctx.guildId);
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
            return ctx.respond(
                tracks.map((track, i) => ({
                    name: `${startIndex + i + 1}. ${i === highlightIndex ? "🗑️" : "🎶"} (${track.time.split}) ${track.name.slice(0, 75)}`,
                    value: startIndex + i + 1
                }))
            );
        },
    }
})
@Middlewares(["cooldown", "queue", "voice", "another_voice", "player-not-playing", "player-wait-stream"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class RemoveTracksCommand extends Command {
    async run({ctx, args}: CommandCallback<number>) {
        const queue = db.queues.get(ctx.guildId);
        const number = args[0] - 1;
        const track = queue.tracks.get(number);

        // Если указан трек которого нет
        if (!track) return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.remove.track.fail", [ctx.member]),
                    color: Colors.DarkRed
                }
            ],
            flags: "Ephemeral"
        });


        const { name, url, api } = track;

        // Если выбран текущий трек
        if (number === queue.tracks.position || queue.tracks.total === 1) {
            // Если треков нет в очереди
            if (!queue.tracks.total || queue.tracks.total === 1) return queue.cleanup();
            setImmediate(() => queue.player.play(0, 0, queue.tracks.position));
        }

        // Удаляем трек и очереди
        queue.tracks.remove(number);

        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.remove.track", [`[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: "Ephemeral"
        });
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ RemoveTracksCommand ];