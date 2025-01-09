import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/tools/SlashBuilder";
import filters from "@lib/db/json/filters.json";
import {Constructor, Handler} from "@handler";
import {AudioFilter} from "@lib/player";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Управление временем, дает возможность пропускать время в треке
 * @class SeekTrackCommand
 * @public
 */
class SeekTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "seek",
                    "ru": "переход"
                })
                .setDescription({
                    "en-US": "Jump to a specific track time!",
                    "ru": "Переход к конкретному времени трека!"
                })
                .addSubCommands([
                    {
                        type: ApplicationCommandOptionType["String"],
                        names: {
                            "en-US": "time",
                            "ru": "время"
                        },
                        descriptions: {
                            "en-US": "It is necessary to specify what time to arrive. Example - 00:00",
                            "ru": "Необходимо указать к какому времени прейти. Пример - 00:00"
                        },
                        required: true,
                    }
                ]),
            rules: ["queue", "voice", "another_voice"],
            execute: ({message, args}) => {
                const {guild} = message;
                const queue = db.audio.queue.get(guild.id);
                const duration = args[0]?.duration();

                //Если пользователь написал что-то не так
                if (isNaN(duration)) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.nan") };
                    return;
                }

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.tracks.track.time.total) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.big") };
                    return;
                }

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "player.playing.off") };
                    return;
                }

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(duration);

                //Отправляем сообщение о пропуске времени
                message.fastBuilder = { color: Colors.Green, description: locale._(message.locale, "command.seek", [duration]) };
            }
        });
    };
}


/**
 * @author SNIPPIK
 * @description Управление модификаторами аудио треков
 * @class AudioFiltersCommand
 * @public
 */
class AudioFiltersCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            builder: new SlashBuilder()
                .setName({
                    "en-US": "filter",
                    "ru": "фильтр"
                })
                .setDescription({
                    "en-US": "Setting filters",
                    "ru": "Управление фильтрами аудио!"
                })
                .addSubCommands([
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
                                choices: db.commands.filters_options
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
                                choices: db.commands.filters_options
                            }
                        ]
                    },
                ]),
            rules: ["queue", "voice", "another_voice"],
            execute: ({message, args, type}) => {
                const {guild} = message;
                const queue = db.audio.queue.get(guild.id);
                const player = queue.player;

                // Если статус плеера не позволяет пропустить поток
                if (!queue.player.playing) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "player.playing.off"),
                        color: Colors.Yellow
                    };

                    return;
                }

                // Выключаем все фильтры
                else if (type === "off") {
                    // Если нет фильтров
                    if (queue.player.filters.enable.length === 0) {
                        message.fastBuilder = { description: locale._(message.locale, "command.filter.off.null") };
                        return;
                    }

                    // Удаляем фильтры
                    queue.player.filters.enable.splice(0, queue.player.filters.enable.length);

                    // Если можно выключить фильтр или фильтры сейчас
                    if (player.audio.current.duration < player.tracks.track.time.total + db.audio.options.optimization) {
                        queue.player.play(queue.player.audio.current?.duration);

                        // Сообщаем о выключении фильтров
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.off.before"),
                            color: Colors.Green, timestamp: new Date()
                        };
                    }

                    // Если нельзя выключить фильтр или фильтры сейчас
                    else {
                        // Сообщаем о выключении фильтров
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.off.after"),
                            color: Colors.Green, timestamp: new Date()
                        };
                    }
                    return;
                }

                const seek: number = queue.player.audio.current?.duration ?? 0;
                const name = args[args.length - 2 || args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;
                const Filter = filters.find((item) => item.name === name) as AudioFilter;
                const findFilter = queue.player.filters.enable.find((fl) => fl.name === Filter.name);

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
                        for (let i = 0; i < queue.player.filters.enable.length; i++) {
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
                        queue.player.filters.enable.push(Filter);

                        // Если можно включить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total + db.audio.options.optimization) {
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
                        const index = queue.player.filters.enable.indexOf(findFilter);
                        queue.player.filters.enable.splice(index, 1);

                        // Если можно выключить фильтр или фильтры сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total + db.audio.options.optimization) {
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
 * @description Делаем классы глобальными
 */
export default Object.values({SeekTrackCommand, AudioFiltersCommand});