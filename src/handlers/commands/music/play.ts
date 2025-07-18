import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType, Colors } from "discord.js";
import { locale } from "#service/locale";
import { Assign } from "#structures";
import { db } from "#app/db";
import * as console from "node:console";

/**
 * @author SNIPPIK
 * @description Включение музыки
 * @class PlayCommand
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "play",
        "ru": "играть"
    },
    descriptions: {
        "en-US": "Turning on music, or searching for music!",
        "ru": "Включение музыки, или поиск музыки!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    names: {
        "en-US": "api",
        "ru": "платформа"
    },
    descriptions: {
        "en-US": "Turn on music by link or title!",
        "ru": "Включение музыки по ссылке или названию!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "select",
                "ru": "платформа"
            },
            descriptions: {
                "en-US": "Which platform does the request belong to?",
                "ru": "К какой платформе относится запрос?"
            },
            type: ApplicationCommandOptionType["String"],
            required: true,
            choices: db.api.allow.map((platform) => {
                return {
                    name: `${platform.name.toLowerCase()} | ${platform.url}`,
                    value: platform.name
                }
            })
        },
        {
            names: {
                "en-US": "request",
                "ru": "запрос"
            },
            descriptions: {
                "en-US": "You must specify the link or the name of the track!",
                "ru": "Необходимо указать ссылку или название трека!"
            },
            required: true,
            type: ApplicationCommandOptionType["String"],
            autocomplete: true
        }
    ],
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "replay",
        "ru": "заново"
    },
    descriptions: {
        "en-US": "Restart queue!!! Necessary for re-enabling if playback has been completed!",
        "ru": "Перезапуск очереди!!! Необходимо для повторного включения если проигрывание было завершено!"
    },
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "stop",
        "ru": "стоп"
    },
    descriptions: {
        "en-US": "Forced termination of music playback!",
        "ru": "Принудительное завершение проигрывания музыки!"
    },
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "wave",
        "ru": "поток"
    },
    descriptions: {
        "en-US": "Endless track playback mode!",
        "ru": "Добавление себе подобных треков!"
    },
    options: [
        {
            names: {
                "en-US": "select",
                "ru": "платформа"
            },
            descriptions: {
                "en-US": "Which platform does the request belong to?",
                "ru": "К какой платформе относится запрос?"
            },
            type: ApplicationCommandOptionType["String"],
            required: true,
            choices: db.api.allowWave.map((platform) => {
                return {
                    name: `${platform.name.toLowerCase()} | ${platform.url}`,
                    value: platform.name
                }
            })
        },
        {
            names: {
                "en-US": "request",
                "ru": "запрос"
            },
            descriptions: {
                "en-US": "You must specify the link or the name of the track!",
                "ru": "Необходимо указать ссылку или название трека!"
            },
            required: true,
            type: ApplicationCommandOptionType["String"],
            autocomplete: true
        }
    ]
})
class PlayCommand extends Assign< BaseCommand > {
    public constructor() {
        super({
            middlewares: ["voice", "another_voice"],
            permissions: {
                client: ["Connect", "SendMessages", "Speak", "ViewChannel"]
            },
            execute: async ({message, args, type}) => {
                switch (type) {
                    // Если надо перезапустить проигрывание
                    case "replay": {
                        const queue = db.queues.get(message.guild.id);

                        // Если нет очереди, то и нечего перезапускать
                        if (!queue) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.play.replay.queue", [message.member]),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Переключаем позицию трека на 0
                        queue.player.tracks.position = 0;

                        // Перезапускаем очередь
                        db.queues.restartPlayer = queue.player;
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.play.replay", [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Принудительное завершение проигрывания музыки
                    case "stop": {
                        const queue = db.queues.get(message.guildId);

                        // Если нет очереди, то и нечего не делаем
                        if (!queue) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.play.stop.queue", [message.member]),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Удаляем очередь
                        db.queues.remove(message.guildId);
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.play.stop", [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Включение радио-потока на треку
                    case "wave": {
                        // Запрос к платформе
                        const platform = db.api.request(args[0] as any);

                        // Если платформа заблокирована
                        if (platform.block) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.block"));
                            break;
                        }

                        // Если есть проблема с авторизацией на платформе
                        else if (!platform.auth) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.auth"));
                            break
                        }

                        await message.deferReply().catch(() => {});
                        db.events.emitter.emit("rest/request", platform, message, `${args[1]}&list=RD`);
                        break;
                    }

                    // Если пользователь пытается сделать запрос к API
                    default: {
                        // Запрос к платформе
                        const platform = db.api.request(args[0] as any);

                        // Если платформа заблокирована
                        if (platform.block) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.block"));
                            break;
                        }

                        // Если есть проблема с авторизацией на платформе
                        else if (!platform.auth) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.auth"));
                            break
                        }

                        await message.deferReply().catch(() => {});
                        db.events.emitter.emit("rest/request", platform, message, args[1]);

                        break;
                    }
                }
                return null;
            },
            autocomplete: async ({message, args}) => {
                // Запрос к платформе
                const platform = db.api.request(args[0] as any);

                // Если платформа заблокирована
                if (platform.block || !platform.auth) return;

                // Получаем функцию запроса данных с платформы
                const api = platform.request(args[1], {audio: false});

                if (!api.type) return;

                try {
                    // Получаем данные в системе rest/API
                    const rest = await api.request();
                    const items: { value: string; name: string }[] = [];

                    // Если получена ошибка или нет данных
                    if (rest instanceof Error || !rest) return;

                    // Обработка массива данных
                    if (Array.isArray(rest)) {
                        const tracks = rest.map((choice) => ({
                            value: choice.url,
                            name: `🎵 (${choice.time.split}) | ${choice.artist.title.slice(0, 20)} - ${choice.name.slice(0, 60)}`
                        }));
                        items.push(...tracks);
                    }

                    // Показываем плейлист
                    else if ("items" in rest) items.push({ name: `🎶 [${rest.items.length}] - ${rest.title.slice(0, 70)}`, value: rest.url });

                    // Показываем трек
                    else items.push({ name: `🎵 (${rest.time.split}) | ${rest.artist.title.slice(0, 20)} - ${rest.name.slice(0, 60)}`, value: rest.url });

                    // Отправка ответа
                    await message.respond(items);
                } catch (err) {
                    console.error(err);
                    return null;
                }
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ PlayCommand ];