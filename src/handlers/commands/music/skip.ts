import { BaseCommand, SlashCommand, SlashCommandSubCommand } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { locale } from "#service/locale";
import { Assign } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Пропуск треков до указанного трека!
 * @class SkipUtilityCommand
 * @extends Assign
 * @public
 */
@SlashCommand({
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
@SlashCommandSubCommand({
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
@SlashCommandSubCommand({
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
@SlashCommandSubCommand({
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
            middlewares: ["voice", "another_voice", "queue", "player-not-playing"],
            autocomplete: ({message, args, type}) => {
                const number = args[0];
                const queue = db.queues.get(message.guildId);
                if (!queue || isNaN(number) || number <= 0) return null;

                const total = queue.tracks.total;
                const position = queue.tracks.position;
                const maxSuggestions = 5;

                let startIndex: number | null = null;
                let icon: string;

                if (type === "back") {
                    if (position === 0) return null;
                    startIndex = Math.max(0, position - number);
                    icon = "⬅️";
                } else if (type === "next") {
                    startIndex = Math.min(total - 1, position + number);
                    icon = "➡️";
                } else {
                    startIndex = number - 1;
                    if (startIndex < 0 || startIndex >= total) return null;
                    icon = "🎵";
                }

                // Окно подсказок с центровкой вокруг startIndex
                const half = Math.floor(maxSuggestions / 2);
                let start = startIndex - half;
                let end = startIndex + half;

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

                    results.push({
                        name: `${i + 1}. ${i === startIndex ? icon : "🎶"} (${track.time.split}) ${track.name.slice(0, 120)}`,
                        value: i
                    });
                }

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
                player.stop(number);

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