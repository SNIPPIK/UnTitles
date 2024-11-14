import {ApplicationCommandOptionType, Colors} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @class PlayCommand
 * @command play
 * @description Включение музыки
 */
class PlayCommand extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName({
                    "en-US": "play",
                    "ru": "воспроизведение"
                })
                .setDescription({
                    "en-US": "Play music of your choice!",
                    "ru": "Включайте музыку по вашему выбору!"
                })
                .addSubCommands([
                    {
                        names: {
                            "en-US": "api",
                            "ru": "api"
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
                                        name: `[${platform.requests.length}] - ${platform.name} | ${platform.url}`,
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
                                type: ApplicationCommandOptionType["String"]
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
                    }
                ])
                .json,
            rules: ["voice", "another_voice"],
            execute: ({message, args, type}) => {
                // Если пользователь прикрепил файл
                if (type === "file") {
                    const attachment = message.options.getAttachment("input");

                    // Если пользователь подсунул фальшивку
                    if (!attachment.contentType.match("audio")) {
                        message.fastBuilder = { description: locale._(message.locale, "attachment.audio.fail"), color: Colors.Yellow }
                        return;
                    }

                    db.audio.queue.events.emit("request/api", message, ["DISCORD", attachment]);
                    return;
                }

                // Если пользователя пытается включить трек
                db.audio.queue.events.emit("request/api", message, args);
                return;
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({PlayCommand});