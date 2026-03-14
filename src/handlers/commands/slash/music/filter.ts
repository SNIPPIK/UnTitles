import { Locales, Middlewares, Command, type CommandContext, createIntegerOption, createStringOption, Declare, Options, SubCommand } from "seyfert";
import filters from "#core/player/filters.json";
import { MessageFlags } from "seyfert/lib/types";
import { AudioFilter } from "#core/player";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Создаем список фильтров для дискорд
 * @public
 */
function createFilters() {
    const temples = [];

    // Если фильтров слишком много
    if (filters.length > 25) return temples;

    // Перебираем фильтр
    for (const filter of filters as AudioFilter[]) {
        // Проверяем кол-во символов на допустимость discord (100 шт.)
        for (const [key, value] of Object.entries(filter.locale)) {
            if (value.startsWith("[")) continue;

            // Добавляем диапазон аргументов
            if (filter.args) filter.locale[key] = `<${filter.args[0]}-${filter.args[1]}> - ${filter.locale[key]}`;

            // Удаляем лишний размер описания
            filter.locale[key] = value.length > 75 ? `**${filter.name}** - ${filter.locale[key].substring(0, 75)}...` : `[${filter.name}] - ${filter.locale[key]}`;
        }

        // Создаем список для показа фильтров в командах
        temples.push({
            name: filter.locale[Object.keys(filter.locale)[0]],
            name_localizations: filter.locale,
            value: filter.name
        });
    }

    return temples;
}

/**
 * @description Подкоманда для отключения фильтра
 */
@Declare({
    name: "disable",
    description: "Disabled filters!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    filter: createStringOption({
        description: "You must enter the name of the enabled filter!",
        name_localizations: {
            "en-US": "filter",
            "ru": "фильтр"
        },
        description_localizations: {
            "en-US": "You must enter the name of the enabled filter",
            "ru": "Необходимо ввести название включенного фильтра"
        },
        required: true,
        autocomplete: (ctx) => {
            const queue = db.queues.get(ctx.guildId);

            // Если нет очереди
            if (!queue) return null;

            const filters = queue.player.filters;

            // Если нет включенных фильтров
            if (!filters.size) return null;

            const items = filters.filter(filter => !!filter.name.match(ctx.options["filters"])).map((filter) => {
                return {
                    name: `🌀 ${filter.name}`,
                    value: filter.name
                }
            });

            // Если не найдено таких фильтров
            if (!items) {
                // Показываем все фильтры
                return ctx.respond(filters.array.map((filter) => {
                    return {
                        name: `🌀 ${filter.name}`,
                        value: filter.name
                    }
                }));
            }

            // Отправка ответа
            return ctx.respond(items);
        }
    }),
})
@Locales({
    name: [
        ["ru", "отключить"],
        ["en-US", "disable"]
    ],
    description: [
        ["ru", "Отключение фильтров!"],
        ["en-US", "Disabled filters!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkQueue", "checkAnotherVoice", "checkPlayerIsPlaying", "checkPlayerWaitStream"])
class FilterRemoveCommand extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const queue = db.queues.get(ctx.guildId);
        const player = queue.player;
        const seek: number = player.audio.current?.duration ?? 0;

        const name: string = ctx.options.filter;
        const Filter = filters.find((item) => item.name === name) as AudioFilter;
        const findFilter = Filter && queue.player.filters.size > 0 ? player.filters.find((fl) => fl.name === Filter.name) : false;

        // Пользователь пытается выключить выключенный фильтр
        if (!findFilter) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.remove.two"),
                        color: Colors.Yellow
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Удаляем фильтр
        player.filters.delete(findFilter);

        // Если можно выключить фильтр или фильтры сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.play(seek).catch(console.error);

            // Сообщаем о включении фильтров
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.remove.after", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если нельзя выключить фильтр или фильтры сейчас.
        // Сообщаем о включении фильтров
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.filter.remove.before", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                    color: Colors.Green,
                    timestamp: new Date() as any
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}


/**
 * @description Подкоманда для включения фильтра
 */
@Declare({
    name: "push",
    description: "Added filter in queue!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Options({
    filters: createStringOption({
        description: "You must select an audio filter!",
        name_localizations: {
            "en-US": "filter",
            "ru": "фильтр"
        },
        description_localizations: {
            "en-US": "You must select an audio filter!",
            "ru": "Необходимо выбрать аудио фильтр!"
        },
        required: true,
        choices: createFilters()
    }),
    argument: createIntegerOption({
        description: "Argument is required! After name <> valid range",
        name_localizations: {
            "en-US": "value",
            "ru": "значение"
        },
        description_localizations: {
            "en-US": "Argument is required! After name <> valid range",
            "ru": "Необходимо указать аргумент! После название <> допустимый диапазон"
        },

        required: false,
    })
})
@Locales({
    name: [
        ["ru", "добавить"],
        ["en-US", "push"]
    ],
    description: [
        ["ru", "Добавление фильтров!"],
        ["en-US", "Adding filters!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkQueue", "checkAnotherVoice", "checkPlayerIsPlaying", "checkPlayerWaitStream"])
class FilterPushCommand extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const queue = db.queues.get(ctx.guildId);
        const player = queue.player;
        const seek: number = player.audio.current?.duration ?? 0;

        const name: string = ctx.options.filters;
        const argument: number = ctx.options.argument;
        const Filter = filters.find((item) => item.name === name) as AudioFilter;
        const findFilter = Filter && queue.player.filters.size > 0 ? player.filters.find((fl) => fl.name === Filter.name) : false;

        // Пользователь пытается включить включенный фильтр
        if (findFilter) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.push.two"),
                        color: Colors.Yellow
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Делаем проверку на аргументы
        else if (Filter.args) {
            // Если аргументы подходят
            if (argument && argument >= Filter.args[0] && argument <= Filter.args[1]) Filter.argument = argument;
            else {
                return ctx.write({
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "command.filter.push.argument", Filter.args),
                            color: Colors.Yellow
                        }
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }
        }

        // Делаем проверку на совместимость
        // Проверяем, не конфликтует ли новый фильтр с уже включёнными
        const unsupportedFilters = player.filters.hasUnsupported(Filter);

        // Проверяем, не конфликтует ли новый фильтр с уже включёнными
        if (unsupportedFilters) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.push.unsupported", unsupportedFilters),
                        color: Colors.DarkRed
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Добавляем фильтр
        player.filters.add(Filter);

        // Если можно включить фильтр или фильтры сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.play(seek).catch(console.error);

            // Сообщаем о включении фильтров
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.push.before", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если нельзя включить фильтр или фильтры сейчас.
        // Сообщаем о включении фильтров
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.filter.push.after", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                    color: Colors.Green,
                    timestamp: new Date() as any
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}


/**
 * @description Подкоманда для полного отключения фильтров
 */
@Declare({
    name: "off",
    description: "Disable all filters!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Locales({
    name: [
        ["ru", "выкл"],
        ["en-US", "off"]
    ],
    description: [
        ["ru", "Отключение всех фильтров!"],
        ["en-US", "Disable all filters!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkQueue", "checkAnotherVoice", "checkPlayerIsPlaying", "checkPlayerWaitStream"])
class FilterOffCommand extends SubCommand {
    async run(ctx: CommandContext<any>) {
        const queue = db.queues.get(ctx.guildId);
        const player = queue.player;


        // Если нет включенных фильтров
        if (player.filters.size === 0) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.off.null"),
                        color: Colors.Yellow
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если можно выключить фильтр или фильтры сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.play(player.audio.current?.duration).catch(console.error);

            // Сообщаем о выключении фильтров
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.off.after"),
                        color: Colors.Green,
                        timestamp: new Date() as any,
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если нельзя выключить фильтр или фильтры сейчас
        else {
            // Сообщаем о выключении фильтров
            await ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.off.before"),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Удаляем фильтры
        player.filters.clear();
        return null;
    };
}


/**
 * @description Главная команда, идет как группа
 */
@Declare({
    name: "filter",
    description: "Manage audio filters",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
})
@Locales({
    name: [
        ["ru", "фильтр"],
        ["en-US", "filter"]
    ],
    description: [
        ["ru", "Отключение всех фильтров!"],
        ["en-US", "Управление фильтрами аудио!"]
    ]
})
@Options([FilterPushCommand, FilterRemoveCommand, FilterOffCommand])
export default class FilterCommand extends Command {
    async run() {}
}