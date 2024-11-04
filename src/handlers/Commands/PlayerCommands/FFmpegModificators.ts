import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import filters from "@lib/db/json/filters.json";
import {Constructor, Handler} from "@handler";
import {AudioFilter} from "@lib/player";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class SeekTrackCommand
 * @command seek
 * @description Пропуск времени в текущем треке
 *
 * @param value - Время для пропуска времени
 */
class SeekTrackCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("seek")
                .setDescription("Пропуск времени в текущем треке!")
                .setDescriptionLocale({
                    "en-US": "Skipping the time in the current track!"
                })
                .addSubCommands([
                    {
                        name: "value",
                        description: "Пример - 00:00",
                        descriptionLocalizations: {
                            "en-US": "Example - 00:00"
                        },
                        required: true,
                        type: ApplicationCommandOptionType["String"]
                    }
                ]).json,
            rules: ["queue", "voice", "anotherVoice"],
            execute: ({message, args}) => {
                const {author, guild} = message;
                const queue = db.audio.queue.get(guild.id);
                const duration = args[0]?.duration();

                //Если пользователь не указал время
                if (!duration) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration") }
                    return;
                }

                //Если пользователь написал что-то не так
                else if (isNaN(duration)) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.nan") }
                    return;
                }

                //Если пользователь указал времени больше чем в треке
                else if (duration > queue.songs.song.duration.seconds) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "command.seek.duration.big") }
                    return;
                }

                //Если музыку нельзя пропустить из-за плеера
                else if (!queue.player.playing) {
                    message.fastBuilder = { color: Colors.DarkRed, description: locale._(message.locale, "player.playing.off") }
                    return;
                }

                //Начинаем проигрывание трека с <пользователем указанного тайм кода>
                queue.player.play(queue.songs.song, duration);

                //Отправляем сообщение о пропуске времени
                message.fastBuilder = { color: Colors.Green, description: locale._(message.locale, "command.seek", [duration]) }
            }
        });
    };
}


/**
 * @class AudioFiltersCommand
 * @command filter
 * @description Управление модификаторами аудио треков
 */
class AudioFiltersCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("filter")
                .setDescription("Управление фильтрами аудио!")
                .addSubCommands([
                    {
                        name: "off",
                        description: "Отключение всех фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Disable all filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "push",
                        description: "Добавление фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Adding filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                descriptionLocalizations: {
                                    "en-US": "You need to select a filter! All available filters are all"
                                },
                                type: ApplicationCommandOptionType["String"],
                                required: true,
                                choices: filters.length < 25 ? filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        nameLocalizations: {
                                            "en-US": `${filter.name} | ${filter.description_localizations["en-US"].length > 75 ? `${filter.description_localizations["en-US"].substring(0, 75)}...` : filter.description_localizations["en-US"]}`
                                        },
                                        value: filter.name
                                    }
                                }) : []
                            },
                            {
                                name: "argument",
                                description: "Аргумент для фильтра, если он необходим!",
                                descriptionLocalizations: {
                                    "en-US": "An argument for the filter, if necessary!"
                                },
                                type: ApplicationCommandOptionType["String"]
                            }
                        ]
                    },
                    {
                        name: "remove",
                        description: "Удаление фильтров!",
                        descriptionLocalizations: {
                            "en-US": "Removing filters!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "filters",
                                description: "Необходимо выбрать фильтр! Все доступные фильтры - all",
                                descriptionLocalizations: {
                                    "en-US": "You need to select a filter! All available filters are all"
                                },
                                type: ApplicationCommandOptionType["String"],
                                required: true,
                                choices: filters.length < 25 ? filters.map((filter) => {
                                    return {
                                        name: `${filter.name} | ${filter.description.length > 75 ? `${filter.description.substring(0, 75)}...` : filter.description}`,
                                        nameLocalizations: {
                                            "en-US": `${filter.name} | ${filter.description_localizations["en-US"].length > 75 ? `${filter.description_localizations["en-US"].substring(0, 75)}...` : filter.description_localizations["en-US"]}`
                                        },
                                        value: filter.name
                                    }
                                }) : []
                            }
                        ]
                    },
                ]).json,
            rules: ["queue", "voice", "anotherVoice"],
            execute: ({message, args, type}) => {
                const {author, guild} = message;
                const queue = db.audio.queue.get(guild.id);

                //Если статус плеера не позволяет пропустить поток
                if (!queue.player.playing) {
                    message.fastBuilder = {
                        description: locale._(message.locale, "player.playing.off"),
                        color: Colors.Yellow
                    };

                    return;
                }

                const seek: number = queue.player.audio.current?.duration ?? 0;
                const name = args[args.length - 2 || args?.length - 1] ?? args[0];
                const arg = args.length > 1 ? Number(args[args?.length - 1]) : null;
                const Filter = filters.find((item) => item.name === name) as AudioFilter;
                const index = queue.player.filters.enable.indexOf(Filter);

                switch (type) {
                    // Выключаем все фильтры
                    case "off": {
                        // Если нет фильтров
                        if (queue.player.filters.enable.length === 0) {
                            message.fastBuilder = { description: "Temple text, code:flt2670" };
                            return;
                        }

                        // Удаляем фильтры
                        queue.player.filters.enable.splice(0, queue.player.filters.enable.length);
                        queue.player.play(queue.songs.song, seek);
                        return;
                    }

                    // Добавляем фильтр
                    case "push": {
                        // Пользователь пытается включить включенный фильтр
                        if (index !== -1) {
                            message.fastBuilder = { description: "Temple text, code:flt2671" };
                            return;
                        }

                        // Делаем проверку на аргументы
                        else if (Filter.args) {
                            // Если аргументы подходят
                            if (arg && arg >= Filter.args[0] && arg <= Filter.args[1]) Filter.user_arg = arg;
                            else {
                                message.fastBuilder = { description: "Temple text, code:flt2672" };
                                return;
                            }
                        }

                        // Делаем проверку на совместимость
                        for (let i = 0; i < queue.player.filters.enable.length; i++) {
                            const filter = queue.player.filters[i];

                            // Если фильтры не совместимы
                            if (Filter.unsupported.includes(filter.name)) {
                                message.fastBuilder = {
                                    description: locale._(message.locale, "command.filter.unsupported"),
                                    color: Colors.DarkRed
                                };

                                return;
                            }
                        }

                        // Добавляем и включаем фильтр
                        queue.player.filters.enable.push(Filter);
                        queue.player.play(queue.songs.song, seek);

                        // Сообщаем о новом фильтре
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.pushed", [Filter.name, Filter.description_localizations[message.locale] ?? Filter.description]),
                            color: Colors.Green, timestamp: new Date()
                        };
                        return;
                    }

                    // Удаляем фильтр из включенных
                    case "remove": {
                        // Пользователь пытается выключить выключенный фильтр
                        if (index === -1) {
                            message.fastBuilder = { description: "Temple text, code:flt2670" };
                            return;
                        }

                        // Удаляем фильтр
                        queue.player.filters.enable.splice(index, 1);
                        queue.player.play(queue.songs.song, seek);

                        // Сообщаем об удалении фильтра
                        message.fastBuilder = {
                            description: locale._(message.locale, "command.filter.removed", [Filter.name, Filter.description_localizations[message.locale] ?? Filter.description]),
                            color: Colors.Green
                        };
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