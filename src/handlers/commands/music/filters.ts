import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import filters from "@service/player/filters.json"
import {AudioFilter} from "@service/player";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Управление модификаторами аудио треков
 * @class AudioFiltersCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "filter",
        "ru": "фильтр"
    },
    descriptions: {
        "en-US": "Setting audio filters",
        "ru": "Управление фильтрами аудио!"
    },
    dm_permission: false,
    options: [
        {
            names: {
                "en-US": "off",
                "ru": "выкл"
            },
            descriptions: {
                "en-US": "Disable all filters!",
                "ru": "Отключение всех фильтров!"
            },
            type: ApplicationCommandOptionType.Subcommand
        },
        {
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
        },
        {
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
                        "en-US": "You need to select a filter! [names] - <not required> - description",
                        "ru": "Необходимо выбрать фильтр! [названия] - <не требуется> - описание"
                    },
                    type: ApplicationCommandOptionType["String"],
                    required: true,
                    choices: db.commands.filters_choices
                }
            ]
        },
    ]
})
class AudioFiltersCommand extends Assign<Command> {
    public constructor() {
        super({
            rules: ["queue", "voice", "another_voice", "player-not-playing"],
            execute: ({message, args, type}) => {
                const queue = message.queue;
                const player = queue.player;

                // Выключаем все фильтры
                if (type === "off") {
                    // Если нет фильтров
                    if (queue.player.filters.enabled.length === 0) {
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.off.null")
                        };
                        return;
                    }

                    // Удаляем фильтры
                    queue.player.filters.enabled.splice(0, queue.player.filters.enabled.length);

                    // Если можно выключить фильтр или фильтры сейчас
                    if (player.audio.current.duration < player.tracks.track.time.total + db.queues.options.optimization) {
                        queue.player.play(queue.player.audio.current?.duration);

                        // Сообщаем о выключении фильтров
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.off.after"),
                            color: Colors.Green, timestamp: new Date()
                        };
                    }

                    // Если нельзя выключить фильтр или фильтры сейчас
                    else {
                        // Сообщаем о выключении фильтров
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.off.before"),
                            color: Colors.Green, timestamp: new Date()
                        };
                    }
                    return;
                }

                const seek: number = queue.player.audio.current?.duration ?? 0;
                const name = args[args.length - 2 || args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;
                const Filter = filters.find((item) => item.name === name) as AudioFilter;
                const findFilter = queue.player.filters.enabled.find((fl) => fl.name === Filter.name);

                switch (type) {
                    // Добавляем фильтр
                    case "push": {
                        // Пользователь пытается включить включенный фильтр
                        if (findFilter) {
                            message.fastBuilder = { description: locale._(message.locale, "command.filter.push.two") };
                            return;
                        }

                        // Делаем проверку на аргументы
                        else if (Filter.args) {
                            // Если аргументы подходят
                            if (arg && arg >= Filter.args[0] && arg <= Filter.args[1]) Filter.user_arg = arg;
                            else {
                                message.fastBuilder = { description: locale._(message.locale, "command.filter.push.argument", Filter.args) };
                                return;
                            }
                        }

                        // Делаем проверку на совместимость
                        for (let i = 0; i < queue.player.filters.enabled.length; i++) {
                            const filter = queue.player.filters[i];

                            // Если фильтры не совместимы
                            if (filter && Filter.unsupported.includes(filter?.name)) {
                                message.fastBuilder = {
                                    description: locale._(message.locale, "command.filter.push.unsupported", [filter.name, Filter.name]),
                                    color: Colors.DarkRed
                                };

                                return;
                            }
                        }

                        // Добавляем фильтр
                        queue.player.filters.enabled.push(Filter);

                        // Если можно включить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total + db.queues.options.optimization) {
                            queue.player.play(seek);

                            // Сообщаем о включении фильтров
                            message.fastBuilder = {
                                description: locale._(message.locale, "command.filter.push.before", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                color: Colors.Green, timestamp: new Date()
                            };
                        }

                        // Если нельзя включить фильтр или фильтры сейчас
                        else {
                            // Сообщаем о включении фильтров
                            message.fastBuilder = {
                                description: locale._(message.locale, "command.filter.push.after", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                color: Colors.Green, timestamp: new Date()
                            };
                        }
                        return;
                    }

                    // Удаляем фильтр из включенных
                    case "remove": {
                        // Пользователь пытается выключить выключенный фильтр
                        if (findFilter) {
                            message.fastBuilder = {
                                description: locale._(message.locale, "command.filter.remove.two"),
                                color: Colors.Yellow
                            };
                            return;
                        }

                        // Удаляем фильтр
                        const index = queue.player.filters.enabled.indexOf(findFilter);
                        queue.player.filters.enabled.splice(index, 1);

                        // Если можно выключить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total + db.queues.options.optimization) {
                            queue.player.play(seek);

                            // Сообщаем о включении фильтров
                            message.fastBuilder = {
                                description: locale._(message.locale, "command.filter.remove.before", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                color: Colors.Green, timestamp: new Date()
                            };
                        }

                        // Если нельзя выключить фильтр или фильтры сейчас
                        else {
                            // Сообщаем о включении фильтров
                            message.fastBuilder = {
                                description: locale._(message.locale, "command.filter.remove.after", [Filter.name, Filter.locale[message.locale].split(" - ").pop()]),
                                color: Colors.Green, timestamp: new Date()
                            };
                        }
                        return;
                    }
                }
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ AudioFiltersCommand});