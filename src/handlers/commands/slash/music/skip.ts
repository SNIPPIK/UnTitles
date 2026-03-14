import {
    Command,
    type CommandContext,
    createNumberOption,
    Declare,
    Locales,
    Middlewares,
    Options,
    SubCommand
} from "seyfert";
import {MessageFlags} from "seyfert/lib/types";
import {locale} from "#structures";
import {db} from "#app/db";

/**
 * @description Подкоманда для перехода позиции вперед
 */
@Declare({
    name: "next",
    description: "Skip tracks from the current to the specified track!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    value: createNumberOption({
        name_localizations: {
            "en-US": "value",
            "ru": "число"
        },
        description_localizations: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        description: "You need to specify the track number!",
        required: true,
        autocomplete: (ctx) => {
            const number = parseInt(ctx.getInput());
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
            if (!tracks.length) return null;

            // Результаты поиска
            const results = tracks.map((track, i) => ({
                name: `${startIndex + i + 1}. ${i === highlightIndex ? "➡" : "🎶"} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: startIndex + i
            }));

            return ctx.respond(results);
        }
    })
})
@Locales({
    name: [
        ["ru", "вперед"],
        ["en-US", "next"]
    ],
    description: [
        ["ru", "Пропуск треков от текущего до указанного трека!"],
        ["en-US", "Skip tracks from the current to the specified track!"]
    ]
})
class SkipNext extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const number: number = ctx.options.value;
        const {player, tracks} = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.skip.arg.track", [number + 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}


/**
 * @description Подкоманда для перехода позиции назад
 */
@Declare({
    name: "back",
    description: "Move current track to past!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    value: createNumberOption({
        name_localizations: {
            "en-US": "value",
            "ru": "число"
        },
        description_localizations: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        description: "You need to specify the track number!",
        required: true,
        autocomplete: (ctx) => {
            const number = parseInt(ctx.getInput());
            const queue = db.queues.get(ctx.guildId);

            if (!queue || isNaN(number) || number <= 0) return null;

            const position = queue.tracks.position;
            const maxSuggestions = 5;
            const highlightIndex = 0;
            const startIndex = Math.max(0, position - number);

            // Получаем треки
            const tracks = queue.tracks.array(maxSuggestions, startIndex);

            // Если треков нет
            if (!tracks.length) return null;

            // Результаты поиска
            const results = tracks.map((track, i) => ({
                name: `${startIndex + i + 1}. ${i === highlightIndex ? "➡" : "🎶"} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: startIndex + i
            }));

            return ctx.respond(results);
        }
    })
})
@Locales({
    name: [
        ["ru", "назад"],
        ["en-US", "back"]
    ],
    description: [
        ["ru", "Переход от текущего трека к прошлому!"],
        ["en-US", "Move current track to past!"]
    ]
})
class SkipBack extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const number: number = ctx.options.value;
        const {player, tracks} = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.position", [number - 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}


/**
 * @description Подкоманда для перехода к любой позиции
 */
@Declare({
    name: "to",
    description: "Go to the specified track!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    value: createNumberOption({
        name_localizations: {
            "en-US": "value",
            "ru": "число"
        },
        description_localizations: {
            "en-US": "You need to specify the track number!",
            "ru": "Нужно указать номер трека!"
        },
        description: "You need to specify the track number!",
        required: true,
        autocomplete: (ctx) => {
            const number = parseInt(ctx.getInput());
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
            if (!tracks.length) return null;

            // Генерация результатов
            const results = tracks.map((track, i) => ({
                name: `${start + i + 1}. ${i === highlight ? "➡" : "🎶"} (${track.time.split}) ${track.name.slice(0, 75)}`,
                value: start + i
            }));

            return ctx.respond(results);
        }
    })
})
@Locales({
    name: [
        ["ru", "на"],
        ["en-US", "to"]
    ],
    description: [
        ["ru", "Переход к указанному треку!"],
        ["en-US", "Go to the specified track!"]
    ]
})
class SkipTo extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const number: number = ctx.options.value;
        const {player, tracks} = db.queues.get(ctx.guildId);
        const track = tracks.get(number);

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url, api} = track;

        // Переходим к позиции
        player.play(0, 0, number).catch(console.error);

        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.skip.arg.track", [number + 1, `[${name}](${url})`]),
                    color: api.color
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}


/**
 * @description Главная команда, идет как группа
 */
@Declare({
    name: "skip",
    description: "Skip tracks to the specified track! The specified track will be current!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options([SkipTo, SkipBack, SkipNext])
@Locales({
    name: [
        ["ru", "пропуск"],
        ["en-US", "skip"]
    ],
    description: [
        ["ru", "Универсальная команда для управления позицией трека!"],
        ["en-US", "Skip tracks to the specified track! The specified track will be current!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice", "checkQueue", "checkPlayerWaitStream", "checkPlayerIsPlaying"])
export default class SkipCommand extends Command {
    async run() {}
}