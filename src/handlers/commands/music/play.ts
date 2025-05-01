import {Command, SlashCommand, SlashCommandSubCommand} from "@handler/commands";
import {ApplicationCommandOptionType, Colors} from "discord.js";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Включение музыки
 * @class PlayCommand
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "play",
        "ru": "играть"
    },
    descriptions: {
        "en-US": "Turning on music, or searching for music!",
        "ru": "Включение музыки, или поиск музыки!"
    },
    dm_permission: false,
})
@SlashCommandSubCommand({
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
@SlashCommandSubCommand({
    names: {
        "en-US": "file",
        "ru": "файл"
    },
    descriptions: {
        "en-US": "Turning on music using a file!",
        "ru": "Включение музыки с использованием файла!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "input",
                "ru": "файл"
            },
            descriptions: {
                "en-US": "You need to attach a file!",
                "ru": "Необходимо прикрепить файл!"
            },
            type: ApplicationCommandOptionType["Attachment"],
            required: true
        }
    ]
})
@SlashCommandSubCommand({
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
@SlashCommandSubCommand({
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
class PlayCommand extends Assign<Command> {
    public constructor() {
        super({
            rules: ["voice", "another_voice"],
            permissions: {
                client: ["Connect", "SendMessages", "Speak", "ViewChannel"]
            },
            autocomplete: async ({message, args}) => {
                // Если ничего не было указано или указана ссылка
                if (!args[1] || args[1] === "") return;

                // Запрос к платформе
                const platform = db.api.request(args[0] as any);

                // Если платформа заблокирована
                if (platform.block || platform.auth) return;

                // Получаем функцию запроса данных с платформы
                const api = platform.get(args[1]);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) return;

                try {
                    // Получаем данные в системе rest/API
                    const rest = await api.execute(args[1], { limit: db.api.limits[api.name], audio: false });
                    const items: { value: string; name: string }[] = [];

                    // Если получена ошибка или нет данных
                    if (rest instanceof Error || !rest) return;

                    // Обработка массива данных
                    if (Array.isArray(rest)) {
                        const tracks = rest.map((choice) => ({
                            value: choice.url,
                            name: choice.name.slice(0, 120)
                        }));
                        items.push(...tracks);
                    } else {
                        // Обработка одиночного трека или плейлиста
                        items.push({ name: rest["title"] ?? rest["name"], value: rest.url });
                    }

                    // Отправка ответа
                    await message.respond(items);
                } catch (err) {
                    console.error(err);
                    return null;
                }
            },
            execute: async ({message, args, type}) => {
                switch (type) {
                    // Если пользователь прикрепил файл
                    case "file": {
                        const attachment = message.options.getAttachment("input");

                        // Если пользователь подсунул фальшивку
                        if (!attachment.contentType.match(/audio/)) {
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "attachment.audio.fail"),
                                        color: Colors.Yellow
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Запрос к платформе
                        const platform = db.api.request("DISCORD");

                        await message.deferReply().catch(() => {});
                        db.events.emitter.emit("rest/request", platform, message, attachment);
                        break;
                    }

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
                        const queue = db.queues.get(message.guild.id);

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

                        // Очищаем очередь
                        queue.cleanup();

                        // Удаляем очередь
                        queue["destroy"]();
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

                    // Если пользователя пытается сделать запрос к API
                    default: {
                        // Запрос к платформе
                        const platform = db.api.request(args[0] as any);

                        // Если платформа заблокирована
                        if (platform.block) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.block"));
                            break;
                        }

                        // Если есть проблема с авторизацией на платформе
                        else if (platform.auth) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.auth"));
                            break
                        }

                        await message.deferReply().catch(() => {});
                        db.events.emitter.emit("rest/request", platform, message, args[1]);
                        break;
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
export default [ PlayCommand ];