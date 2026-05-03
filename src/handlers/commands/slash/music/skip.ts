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
import { ApplicationCommandOptionType } from "discord.js";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Подкоманда для перехода позиции назад
 */
@Declare({
    names: {
        "en-US": "back",
        "ru": "назад"
    },
    descriptions: {
        "en-US": "Move current track to past!",
        "ru": "Переход от текущего трека к прошлому!"
    }
})
@Options({
    back: {
        names: {
            "en-US": "value",
            "ru": "число"
        },
        descriptions: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        type: ApplicationCommandOptionType.Number,
        required: true,
        autocomplete: ({ctx, args}) => {
            const number = parseInt(args[0]);
            const queue = db.queues.get(ctx.guildId);

            if (!queue || isNaN(number) || number <= 0) return null;

            const position = queue.tracks.position;
            const maxSuggestions = 5;
            const highlightIndex = 0;
            const startIndex = Math.max(0, position - number);

            // Получаем треки
            const tracks = queue.tracks.array(maxSuggestions, startIndex);

            // Если треков нет
            if (!tracks.length) {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.number.null"),
                        value: "|NumberFail|"
                    }
                ])
            }

            // Результаты поиска
            const results = tracks.map((track, i) => ({
                name: `${startIndex + i + 1}. ${i === highlightIndex ? db.emoji.select : db.emoji.queue} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: startIndex + i
            }));

            return ctx.respond(results);
        }
    }
})
class BackPositionCommand extends SubCommand {
    async run({ctx, args}: CommandCallback<number>) {
        const number = args[0];
        const { player, tracks } = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.position", [number - 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: "Ephemeral"
        });
    };
}


/**
 * @description Подкоманда для перехода позиции вперед
 */
@Declare({
    names: {
        "en-US": "next",
        "ru": "вперед"
    },
    descriptions: {
        "en-US": "Skip tracks from the current to the specified track!",
        "ru": "Пропуск треков от текущего до указанного трека!"
    }
})
@Options({
    next: {
        names: {
            "en-US": "value",
            "ru": "число"
        },
        descriptions: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        type: ApplicationCommandOptionType.Number,
        required: true,
        autocomplete: ({ctx, args}) => {
            const number = parseInt(args[0]);
            const queue = db.queues.get(ctx.guildId);

            if (!queue || isNaN(number) || number <= 0) return null;

            const total = queue.tracks.total;
            const position = queue.tracks.position;
            const maxSuggestions = 5;
            const highlightIndex = 0;
            const startIndex = Math.min(total - 1, position + (number - 1));

            // Получаем треки
            const tracks = queue.tracks.array(maxSuggestions, startIndex);

            // Если треков нет
            if (!tracks.length) {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.number.null"),
                        value: "|NumberFail|"
                    }
                ])
            }

            // Результаты поиска
            const results = tracks.map((track, i) => ({
                name: `${startIndex + i + 1}. ${i === highlightIndex ? db.emoji.select : db.emoji.queue} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: startIndex + i
            }));

            return ctx.respond(results);
        }
    }
})
class SkipPositionCommand extends SubCommand {
    async run({ctx, args}: CommandCallback<number>) {
        const number = args[0];
        const {player, tracks} = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.skip.arg.track", [number + 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: "Ephemeral"
        });
    };
}


/**
 * @description Подкоманда для перехода к любой позиции
 */
@Declare({
    names: {
        "en-US": "to",
        "ru": "на"
    },
    descriptions: {
        "en-US": "Go to the specified track!",
        "ru": "Переход к указанному треку!"
    }
})
@Options({
    to: {
        names: {
            "en-US": "value",
            "ru": "число"
        },
        descriptions: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        type: ApplicationCommandOptionType.Number,
        required: true,
        autocomplete: ({ctx, args}) => {
            const number = parseInt(args[0]);
            const queue = db.queues.get(ctx.guildId);

            if (!queue || isNaN(number) || number <= 0) return null;

            const { total } = queue.tracks;
            const max = 5;
            const index = number - 1;

            // Определяем начальную позицию и индекс подсветки
            let start = Math.max(0, index - Math.floor(max / 2));
            if (index >= total) start = Math.max(0, total - max);
            else if (start + max > total) start = Math.max(0, total - max);

            const highlight = Math.max(0, index - start);
            // Получаем массив треков
            const tracks = queue.tracks.array(max, start);

            // Если треков нет
            if (!tracks.length) {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.number.null"),
                        value: "|NumberFail|"
                    }
                ])
            }

            // Генерация результатов
            const results = tracks.map((track, i) => ({
                name: `${start + i + 1}. ${i === highlight ? db.emoji.select : db.emoji.queue} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: start + i
            }));

            return ctx.respond(results);
        }
    }
})
class ToPositionCommand extends SubCommand {
    async run({ctx, args}: CommandCallback<number>) {
        const number = args[0];
        const {player, tracks} = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.skip.arg.track", [number + 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: "Ephemeral"
        });
    };
}


/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipUtilityCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "skip",
        "ru": "пропуск"
    },
    descriptions: {
        "en-US": "Skip tracks to the specified track! The specified track will be current!",
        "ru": "Универсальная команда для управления позицией трека!"
    },
    integration_types: [CommandIntegration.Guild]
})
@Options([BackPositionCommand, SkipPositionCommand, ToPositionCommand])
@Middlewares(["cooldown", "queue", "voice", "another_voice", "player-not-playing", "player-wait-stream"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class SkipUtilityCommand extends Command {
    async run() {}
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [SkipUtilityCommand];