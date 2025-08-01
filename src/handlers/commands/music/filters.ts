import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import filters from "#core/player/filters.json";
import type { AudioFilter } from "#core/player";
import { Colors } from "#structures/discord";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление модификаторами аудио треков
 * @class AudioFiltersCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "filter",
        "ru": "фильтр"
    },
    descriptions: {
        "en-US": "Setting audio filters",
        "ru": "Управление фильтрами аудио!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    names: {
        "en-US": "off",
        "ru": "выкл"
    },
    descriptions: {
        "en-US": "Disable all filters!",
        "ru": "Отключение всех фильтров!"
    },
    type: ApplicationCommandOptionType.Subcommand
})
@CommandOptions({
    names: {
        "en-US": "push",
        "ru": "добавить"
    },
    descriptions: {
        "en-US": "Adding filters!",
        "ru": "Добавление фильтров!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "filters",
                "ru": "фильтры"
            },
            descriptions: {
                "en-US": "You need to select a filter! [names] - <allowable range> - description",
                "ru": "Необходимо выбрать фильтр! [названия] - <допустимый диапазон> - описание"
            },
            type: ApplicationCommandOptionType["String"],
            required: true,
            choices: db.commands.filters_choices
        },
        {
            names: {
                "en-US": "argument",
                "ru": "аргумент"
            },
            descriptions: {
                "en-US": "An argument for the filter, if necessary!",
                "ru": "Аргумент для фильтра, если он необходим!"
            },
            type: ApplicationCommandOptionType["String"]
        }
    ]
})
@CommandOptions({
    names: {
        "en-US": "disable",
        "ru": "отключить"
    },
    descriptions: {
        "en-US": "Disabled filters!",
        "ru": "Отключение фильтров!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "filters",
                "ru": "фильтры"
            },
            descriptions: {
                "en-US": "You need to select a filter!",
                "ru": "Необходимо выбрать фильтр!"
            },
            required: true,
            type: ApplicationCommandOptionType["String"],
            autocomplete: true
        }
    ]
})
class AudioFiltersCommand extends Assign< BaseCommand > {
    public constructor() {
        super({
            middlewares: ["queue", "voice", "another_voice", "player-not-playing", "player-wait-stream"],
            permissions: {
                client: ["SendMessages", "ViewChannel"]
            },
            execute: async ({message, args, type}) => {
                const queue = db.queues.get(message.guildId);
                const player = queue.player;
                const seek: number = player.audio.current?.duration ?? 0;
                const name = args && args?.length > 0 ? args[0] : null;
                const argument = args && args?.length > 1 ? Number(args[1]) : null;

                const Filter = filters.find((item) => item.name === name) as AudioFilter;
                const findFilter = player.filters.enabled.find((fl) => fl.name === name);

                switch (type) {
                    // Если пользователь хочет выключить все аудио фильтры
                    case "off": {
                        // Если нет включенных фильтров
                        if (player.filters.enabled.size === 0) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.off.null"),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если можно выключить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                            await player.play(player.audio.current?.duration);

                            // Сообщаем о выключении фильтров
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.off.after"),
                                        color: Colors.Green,
                                        timestamp: new Date() as any,
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если нельзя выключить фильтр или фильтры сейчас
                        else {
                            // Сообщаем о выключении фильтров
                            await message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.off.before"),
                                        color: Colors.Green,
                                        timestamp: new Date() as any
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Удаляем фильтры
                        player.filters.enabled.clear();
                        return null;
                    }

                    // Если пользователь добавляет аудио фильтр
                    case "push": {
                        // Пользователь пытается включить включенный фильтр
                        if (findFilter) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.push.two"),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Делаем проверку на аргументы
                        else if (Filter.args) {
                            // Если аргументы подходят
                            if (argument && argument >= Filter.args[0] && argument <= Filter.args[1]) Filter.argument = argument;
                            else {
                                return message.reply({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "command.filter.push.argument", Filter.args),
                                            color: Colors.Yellow
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }
                        }

                        // Делаем проверку на совместимость
                        // Проверяем, не конфликтует ли новый фильтр с уже включёнными
                        for (const enabledFilter of player.filters.enabled) {
                            if (!enabledFilter) continue;

                            // Новый фильтр несовместим с уже включённым?
                            if (Filter.unsupported.includes(enabledFilter.name)) {
                                return message.reply({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "command.filter.push.unsupported", [Filter.name, enabledFilter.name]),
                                            color: Colors.DarkRed
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }

                            // Уже включённый фильтр несовместим с новым?
                            if (enabledFilter.unsupported.includes(Filter.name)) {
                                return message.reply({
                                    embeds: [
                                        {
                                            description: locale._(message.locale, "command.filter.push.unsupported", [enabledFilter.name, Filter.name]),
                                            color: Colors.DarkRed
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }
                        }

                        // Добавляем фильтр
                        player.filters.enabled.add(Filter);

                        // Если можно включить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                            await player.play(seek);

                            // Сообщаем о включении фильтров
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.push.before", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                        color: Colors.Green,
                                        timestamp: new Date() as any
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если нельзя включить фильтр или фильтры сейчас.
                        // Сообщаем о включении фильтров
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.filter.push.after", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                    color: Colors.Green,
                                    timestamp: new Date() as any
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Удаляем фильтр из включенных
                    case "disable": {
                        // Пользователь пытается выключить выключенный фильтр
                        if (!findFilter) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.remove.two"),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Удаляем фильтр
                        player.filters.enabled.delete(findFilter);

                        // Если можно выключить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                            await player.play(seek);

                            // Сообщаем о включении фильтров
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.filter.remove.after", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                        color: Colors.Green,
                                        timestamp: new Date() as any
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если нельзя выключить фильтр или фильтры сейчас.
                        // Сообщаем о включении фильтров
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.filter.remove.before", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                    color: Colors.Green,
                                    timestamp: new Date() as any
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }
                }
                return null;
            },
            autocomplete: ({message, args}) => {
                const queue = db.queues.get(message.guildId);

                // Если нет очереди
                if (!queue) return null;

                const filters = queue.player.filters.enabled;

                // Если нет включенных фильтров
                if (!filters) return null;

                const items = filters.filter(filter => !!filter.name.match(args[0])).map((filter) => {
                    return {
                        name: `🌀 ${filter.name}`,
                        value: filter.name
                    }
                });

                // Если не найдено таких фильтров
                if (!items) return null;

                // Отправка ответа
                return message.respond(items);
            },
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [AudioFiltersCommand];