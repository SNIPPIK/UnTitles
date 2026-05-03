import {
    Command,
    CommandCallback,
    CommandIntegration,
    Declare,
    Middlewares,
    Options,
    Permissions,
    SubCommand
} from "#handler/commands/index.js";
import {ApplicationCommandOptionType} from "discord-api-types/v10";
import {Colors} from "#structures/discord/index.js";
import {locale} from "#structures";
import {db} from "#app/db";

/**
 * @author SNIPPIK
 * @description Просмотр треков в очереди
 * @class QueueList
 * @extends SubCommand
 */
@Declare({
    names: {
        "en-US": "list",
        "ru": "список"
    },
    descriptions: {
        "en-US": "View tracks in the current queue!",
        "ru": "Просмотр треков в текущей очереди!"
    }
})
@Options({
    type: {
        names: {
            "en-US": "value",
            "ru": "число"
        },
        descriptions: {
            "en-US": "Specify the track position to get +-10 tracks. When selected, the selected one will be shown",
            "ru": "Укажите позицию трека для получения +-10 треков. При выборе будет показан выбранный"
        },
        type: ApplicationCommandOptionType.Number,
        required: true,
        autocomplete: ({ ctx, args }) => {
            const { tracks } = db.queues.get(ctx.guildId);
            const { position } = tracks;

            const center = args[0] === "0" ? 1 : args[0] - 1;
            const before = tracks.array(-10, center);
            const after = tracks.array(10, center);

            return ctx.respond(
                [...before, ...after].map((track, i) => {
                    const value = center - before.length + i;
                    const isCurrent = value === position;
                    const Selected = center === value;

                    return {
                        name: `${value + 1}. ${isCurrent && !Selected ? db.emoji.current : Selected && !isCurrent ? db.emoji.select : Selected && isCurrent ? db.emoji.select : `${db.emoji.queue}`} (${track.time.split}) | ${track.artist.title.slice(0, 35)} - ${track.name.slice(0, 75)}`,
                        value
                    };
                })
            );
        }
    }
})
class QueueList extends SubCommand {
    async run({ctx, args}: CommandCallback<number>) {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.get(args[0]);

        // Если указан не существующий трек
        if (!track) return ctx.reply(
            {
                embeds: [
                    {
                        description: locale._(ctx.locale, "command.queue.track.notfound", [queue.tracks.total]),
                        color: Colors.White
                    }
                ],
                flags: "Ephemeral"
            }
        );

        const { artist, url, name, image, api, ID, time, user, link } = track;

        // Отправляем данные о выбранном треке
        return ctx.reply({
            embeds: [
                {
                    author: {
                        url: artist.url,
                        name: artist.title,
                        icon_url: artist.image.url
                    },
                    thumbnail: image,
                    description: `[${name}](${url})\n - ${ID}\n - ${time.split}` + (link && link.startsWith("http") ? `\n - 🗃: ❌` : link ? "\n - 🗃: ✅" : ""),
                    color: api.color,

                    footer: {
                        text: `${user.username} | ${api.name} - ${api.url}`,
                        icon_url: user.avatar
                    }
                }
            ],
            flags: "Ephemeral"
        });
    };
}


/**
 * @author SNIPPIK
 * @description Удаление очереди
 * @class QueueDestroy
 * @extends SubCommand
 */
@Declare({
    names: {
        "en-US": "destroy",
        "ru": "удаление"
    },
    descriptions: {
        "en-US": "Queue deletion! No way to return tracks, player, queue!",
        "ru": "Удаление очереди! Без возможности вернуть треки, плеер, очередь!"
    }
})
class QueueDestroy extends SubCommand {
    async run({ctx}: CommandCallback) {
        db.queues.remove(ctx.guildId);
        db.voice.remove(ctx.guildId);

        // Отправляем данные о выбранном треке
        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.queue.destroy"),
                    color: Colors.White
                }
            ],
            flags: "Ephemeral"
        });
    };
}


/**
 * @author SNIPPIK
 * @description Взаимодействие с очередью
 * @class QueueCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "queue",
        "ru": "очередь"
    },
    descriptions: {
        "en-US": "Advanced control of music inclusion!",
        "ru": "Расширенное управление включение музыки!"
    },
    integration_types: [CommandIntegration.Guild]
})
@Options([QueueList, QueueDestroy])
@Middlewares(["cooldown", "voice", "another_voice", "queue"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class QueueCommand extends Command {
    async run() {}
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [QueueCommand];