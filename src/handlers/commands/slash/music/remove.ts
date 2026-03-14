import {Command, type CommandContext, createNumberOption, Declare, Locales, Middlewares, Options} from "seyfert";
import {MessageFlags} from "seyfert/lib/types";
import {locale} from "#structures";
import {db} from "#app/db";
import {Colors} from "#structures/discord";

/**
 * @description Главная команда, удаляет треки из очереди
 */
@Declare({
    name: "remove",
    description: "Deleting a track from the queue, without the possibility of recovery!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    value: createNumberOption({
        description: "Specify the track number in the queue!",
        name_localizations: {
            "en-US": "value",
            "ru": "значение",
        },
        description_localizations: {
            "en-US": "Specify the track number in the queue!",
            "ru": "Укажите номер трека в очереди!"
        },
        required: true,
        autocomplete: async (ctx) => {
            const number = parseInt(ctx.getInput());
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
        }
    })
})
@Locales({
    name: [
        ["ru", "удалить"],
        ["en-US", "remove"]
    ],
    description: [
        ["ru", "Удаление трека из очереди, без возможности восстановить!"],
        ["en-US", "Deleting a track from the queue, without the possibility of recovery!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkQueue", "clientVoiceChannel", "checkPlayerIsPlaying"])
export default class RemoveCommand extends Command {
    async run(ctx: CommandContext<any>) {
        const queue = db.queues.get(ctx.guildId);
        const number: number = ctx.options["value"] - 1;
        const track = queue.tracks.get(number);

        // Если указан трек которого нет
        if (!track) return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.remove.track.fail", [ctx.member]),
                    color: Colors.DarkRed
                }
            ],
            flags: MessageFlags.Ephemeral
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

        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.remove.track", [`[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}