import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {ApplicationCommandOptionType} from "discord.js";
import {API, Constructor, Handler} from "@handler";
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
                .setName("play")
                .setDescription("Проигрывание музыки по вашему выбору!")
                .setDescriptionLocale({
                    "en-US": "Playing music!"
                })
                .addSubCommands([
                    {
                        name: "api",
                        description: "Включение музыки по ссылке или названию!",
                        descriptionLocalizations: {
                            "en-US": "Turn on music by link or title!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "select",
                                description: "К какой платформе относится запрос?",
                                descriptionLocalizations: {
                                    "en-US": "Which platform does the request belong to?"
                                },
                                type: ApplicationCommandOptionType["String"],
                                required: true,
                                choices: db.api.allow.map((platform) => {
                                    return {
                                        name: `[${platform.requests.length}] ${platform.url} | ${platform.name}`,
                                        value: platform.name
                                    }
                                })
                            },
                            {
                                name: "request",
                                description: "Необходимо указать ссылку или название трека!",
                                descriptionLocalizations: {
                                    "en-US": "You must specify the link or the name of the track!"
                                },
                                required: true,
                                type: ApplicationCommandOptionType["String"]
                            }
                        ],
                    },
                    {
                        name: "file",
                        description: "Включение музыки с использованием файла!",
                        descriptionLocalizations: {
                            "en-US": "Turning on music using a file!"
                        },
                        type: ApplicationCommandOptionType.Subcommand,
                        options: [
                            {
                                name: "input",
                                description: "Необходимо прикрепить файл!",
                                descriptionLocalizations: {
                                    "en-US": "You need to attach a file!"
                                },
                                type: ApplicationCommandOptionType["Attachment"],
                                required: true
                            }
                        ]
                    }
                ])
                .json,
            execute: ({message, args, type}) => {
                const {author, member, guild} = message;
                const queue = message.queue;


                //Если пользователь прикрепил файл
                if (type === "file") {
                    const attachment = message.options.getAttachment("input");

                    //Если пользователь подсунул фальшивку
                    //if (!attachment.contentType.match("audio")) return {
                    //    content: locale._(message.locale,"command.play.attachment.audio.need", [author]),
                    //    color: "Yellow"
                    //};

                    db.audio.queue.events.emit("request/api", message, ["DISCORD", attachment]);
                    return;
                }

                //Если пользователя пытается включить трек
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