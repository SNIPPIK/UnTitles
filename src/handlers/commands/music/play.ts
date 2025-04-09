import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
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
    options: [
        {
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
        },
        {
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
        },
        {
            type: ApplicationCommandOptionType.Subcommand,
            names: {
                "en-US": "replay",
                "ru": "заново"
            },
            descriptions: {
                "en-US": "Restart queue!!! Necessary for re-enabling if playback has been completed!",
                "ru": "Перезапуск очереди!!! Необходимо для повторного включения если проигрывание было завершено!"
            },
        },
        {
            type: ApplicationCommandOptionType.Subcommand,
            names: {
                "en-US": "stop",
                "ru": "стоп"
            },
            descriptions: {
                "en-US": "Forced termination of music playback!",
                "ru": "Принудительное завершение проигрывания музыки!"
            },
        }
    ]
})
class PlayCommand extends Assign<Command> {
    public constructor() {
        super({
            deferReply: true,
            rules: ["voice", "another_voice"],
            execute: async ({message, args, type}) => {
                switch (type) {
                    // Если пользователь прикрепил файл
                    case "file": {
                        const attachment = message.options.getAttachment("input");

                        // Если пользователь подсунул фальшивку
                        if (!attachment.contentType.match(/audio/)) {
                            message.FBuilder = { description: locale._(message.locale, "attachment.audio.fail"), color: Colors.Yellow };
                            return;
                        }

                        // Запрос к платформе
                        const platform = db.api.request("DISCORD");

                        db.events.emitter.emit("rest/request", platform, message, attachment);
                        return;
                    }

                    // Если надо перезапустить проигрывание
                    case "replay": {
                        const queue = message.queue;

                        // Если нет очереди, то и нечего перезапускать
                        if (!queue) {
                            message.FBuilder = { description: locale._(message.locale, "command.play.replay.queue", [message.author]), color: Colors.Yellow };
                            return;
                        }

                        // Переключаем позицию трека на 0
                        queue.player.tracks.position = 0;

                        // Перезапускаем очередь
                        db.queues.restartPlayer = queue.player;

                        message.FBuilder = { description: locale._(message.locale, "command.play.replay", [message.author]), color: Colors.Green };
                        return;
                    }

                    // Принудительное завершение проигрывания музыки
                    case "stop": {
                        const queue = message.queue;

                        // Если нет очереди, то и нечего не делаем
                        if (!queue) {
                            message.FBuilder = { description: locale._(message.locale, "command.play.stop.queue", [message.author]), color: Colors.Yellow };
                            return;
                        }

                        // Очищаем очередь
                        queue.cleanup();

                        // Удаляем очередь
                        queue["destroy"]();

                        message.FBuilder = { description: locale._(message.locale, "command.play.stop", [message.author]), color: Colors.Green };
                        return;
                    }

                    // Если пользователя пытается сделать запрос к API
                    default: {
                        // Запрос к платформе
                        const platform = db.api.request(args[0]);

                        // Если платформа заблокирована
                        if (platform.block) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.block"));
                            return;
                        }

                        // Если есть проблема с авторизацией на платформе
                        else if (platform.auth) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.auth"));
                            return;
                        }

                        db.events.emitter.emit("rest/request", platform, message, args[1]);
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
export default Object.values({PlayCommand});