import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipUtilityCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "skip",
        "ru": "пропуск"
    },
    descriptions: {
        "en-US": "Skip tracks to the specified track! The specified track will be current!",
        "ru": "Универсальная команда для управления позицией трека!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    names: {
        "en-US": "back",
        "ru": "назад"
    },
    descriptions: {
        "en-US": "Move current track to past!",
        "ru": "Переход от текущего трека к прошлому!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            autocomplete: true,
            type: ApplicationCommandOptionType["Number"],
        }
    ]
})
@CommandOptions({
    names: {
        "en-US": "to",
        "ru": "на"
    },
    descriptions: {
        "en-US": "Go to the specified track!",
        "ru": "Переход к указанному треку!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            autocomplete: true,
            type: ApplicationCommandOptionType["Number"]
        }
    ]
})
@CommandOptions({
    names: {
        "en-US": "next",
        "ru": "вперед"
    },
    descriptions: {
        "en-US": "Skip tracks from the current to the specified track!",
        "ru": "Пропуск треков от текущего до указанного трека!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "value",
                "ru": "число"
            },
            descriptions: {
                "en-US": "You need to specify the track number!",
                "ru": "Нужно указать номер трека!"
            },
            required: true,
            autocomplete: true,
            type: ApplicationCommandOptionType["Number"]
        }
    ]
})
class SkipUtilityCommand extends Assign< BaseCommand<number> > {
    public constructor() {
        super({
            permissions: {
                client: ["ViewChannel", "SendMessages"]
            },
            middlewares: ["voice", "another_voice", "queue", "player-not-playing", "player-wait-stream"],
            autocomplete: ({message, args, type}) => {
                const number = args[0];
                const queue = db.queues.get(message.guildId);

                if (!queue || isNaN(number) || number <= 0) return null;

                const total = queue.tracks.total;
                const position = queue.tracks.position;
                const maxSuggestions = 5;

                let startIndex: number;
                let icon: string;
                let highlightIndex: number;


                // Если действие назад
                if (type === "back") {
                    icon = "⬅️";
                    highlightIndex = 0;
                    startIndex = Math.max(0, position - number);
                }

                // Если действие вперед
                else if (type === "next") {
                    icon = "➡️";
                    highlightIndex = 0;
                    startIndex = Math.min(total - 1, position + (number - 1));
                }

                // Если действие to
                else {
                    const half = Math.floor(maxSuggestions / 2);
                    const index = number - 1;

                    // Если число больше чем треков есть
                    if (index >= total) {
                        startIndex = Math.max(0, total - half);
                        highlightIndex = total - half;
                    }

                    // Если указано меньше 1
                    else if (index <= 0) {
                        startIndex = 0;
                        highlightIndex = 0;
                    }

                    // Если другое
                    else {
                        startIndex = Math.max(0, index - half);

                        if (startIndex + maxSuggestions > total) {
                            startIndex = Math.max(0, total - maxSuggestions);
                        }

                        highlightIndex = index - startIndex;
                    }

                    icon = "🎵";
                }

                // Получаем треки
                const tracks = queue.tracks.array(maxSuggestions, startIndex);

                // Если треков нет
                if (!tracks.length) return null;

                // Результаты поиска
                const results = tracks.map((track, i) => ({
                    name: `${startIndex + i + 1}. ${i === highlightIndex ? icon : "🎶"} (${track.time.split}) ${track.name.slice(0, 120)}`,
                    value: startIndex + i
                }));

                return message.respond(results);
            },
            execute: async ({message, args, type}) => {
                const number = args[0];
                const {player, tracks} = db.queues.get(message.guildId);
                const track = tracks.get(number);

                // Если указан трек которого нет
                if (!track) return null;

                const {name, url, api} = track;

                // Переходим к позиции
                await player.play(0, 0, number);

                switch (type) {
                    // Переключение текущий позиции назад
                    case "back": {
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.position", [number - 1, `[${name}](${url})`]),
                                    color: api.color
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Переключение текущий позиции в любую сторону
                    case "to": {
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.go.track", [`[${name}](${url})`]),
                                    color: api.color
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Переключение текущий позиции вперед
                    case "next": {
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.skip.arg.track", [number + 1, `[${name}](${url})`]),
                                    color: api.color
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }
                }
                return null;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [SkipUtilityCommand];