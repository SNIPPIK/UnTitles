import {ApplicationCommandOptionType, Colors} from "discord.js";
import {Command, SlashCommand} from "@handler/commands";
import {locale} from "@service/locale";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Управление голосовыми подключениями
 * @class Command_Voice
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "voice",
        "ru": "голос"
    },
    descriptions: {
        "en-US": "Interaction with voice connections",
        "ru": "Взаимодействие с голосовыми подключениями"
    },
    options: [
        {
            names: {
                "en-US": "join",
                "ru": "подключение"
            },
            descriptions: {
                "en-US": "Connecting to voice channel!",
                "ru": "Подключение к голосовому каналу!"
            },
            type: ApplicationCommandOptionType.Subcommand
        },
        {
            names: {
                "en-US": "leave",
                "ru": "отключение"
            },
            descriptions: {
                "en-US": "Disconnecting from the voice channel!",
                "ru": "Отключение от голосового канала!"
            },
            type: ApplicationCommandOptionType.Subcommand
        },
        {
            names: {
                "en-US": "re-configure",
                "ru": "переконфигурация"
            },
            descriptions: {
                "en-US": "Reconnect to the voice channel!",
                "ru": "Переподключение к голосовому каналу!"
            },
            type: ApplicationCommandOptionType.Subcommand
        },
        {
            names: {
                "en-US": "tribune",
                "ru": "трибуна"
            },
            descriptions: {
                "en-US": "Request to broadcast music to the podium!",
                "ru": "Запрос на транслирование музыки в трибуну!"
            },
            type: ApplicationCommandOptionType.Subcommand,
            options: [
                {
                    names: {
                        "en-US": "choice",
                        "ru": "выбор"
                    },
                    descriptions: {
                        "en-US": "Options for interacting with the stands!",
                        "ru": "Варианты взаимодействия с трибунами"
                    },
                    required: true,
                    type: ApplicationCommandOptionType["String"],
                    choices: [
                        {
                            name: "join - Connecting to the podium",
                            nameLocalizations: {
                                "ru": "join - Подключение к трибуне"
                            },
                            value: "join"
                        },
                        {
                            name: "request - Connection request",
                            nameLocalizations: {
                                "ru": "request - Запрос на подключение"
                            },
                            value: "request"
                        }
                    ]
                }
            ]
        }
    ],
    dm_permission: false
})
class Command_Voice extends Assign<Command> {
    public constructor() {
        super({
            rules: ["voice", "another_voice"],
            execute: async ({message, type, args}) => {
                const { guild } = message;
                const VoiceChannel = message.voice.channel;
                const voiceConnection = db.voice.get(guild.id);
                const queue = message.queue;

                switch (type) {
                    // Подключение к голосовому каналу
                    case "join": {
                        // Если производится попытка подключится к тому же голосовому каналу
                        if (voiceConnection && voiceConnection.config.channelId === VoiceChannel.id) return;

                        // Если есть очередь сервера
                        if (queue) queue.voice = message.voice;

                        // Подключаемся к голосовому каналу без очереди
                        else db.voice.join({ channelId: VoiceChannel.id, guildId: guild.id, selfDeaf: true, selfMute: true }, guild.voiceAdapterCreator);

                        // Отправляем сообщение о подключении к каналу
                        message.fastBuilder = {
                            color: Colors.Green,
                            description: locale._(message.locale, "voice.join", [VoiceChannel])
                        };
                        return;
                    }

                    // Переконфигурация голосового канала
                    case "re-configure": {
                        // Выбор лучшего региона для текущий голосовой сессии
                        VoiceChannel.setRTCRegion(null)
                            // Если не получилось сменить регион
                            .catch(() => {
                                message.fastBuilder = {
                                    color: Colors.DarkRed,
                                    description: locale._(message.locale, "voice.rtc.fail")
                                }
                            })

                            // Если получилось сменить регион
                            .finally(() => {
                                //Перенастройка подключения
                                voiceConnection.configureSocket();

                                message.fastBuilder = {
                                    color: Colors.Green,
                                    description: locale._(message.locale, "voice.rtc")
                                }
                            });
                        return;
                    }

                    // Отключение от голосового канала
                    case "leave": {
                        // Если есть очередь, то удаляем ее!
                        if (queue) queue.cleanup();

                        // Отключаемся от голосового канала
                        voiceConnection.disconnect();

                        message.fastBuilder = {
                            color: Colors.Green,
                            description: locale._(message.locale, "voice.leave", [VoiceChannel])
                        };
                        return;
                    }

                    // Взаимодействие с трибуной
                    case "tribune": {
                        const me = message.guild.members?.me;

                        try {
                            // Если бота просят подключится
                            if (args[0] === "join") await me.voice.setSuppressed(true);

                            // Если бота просят сделать запрос
                            else await me.voice.setRequestToSpeak(true);
                        } catch (err) {
                            // Если не удалось подключиться или сделать запрос
                            message.fastBuilder = {
                                description: args[0] === "join" ? locale._(message.locale, "voice.tribune.join.fail") : locale._(message.locale, "voice.tribune.join.request.fail"),
                                color: Colors.DarkRed
                            };
                            return;
                        }

                        // Если удалось подключиться или сделать запрос
                        message.fastBuilder = {
                            description: args[0] === "join" ? locale._(message.locale, "voice.tribune.join") : locale._(message.locale, "voice.tribune.join.request"),
                            color: Colors.Green
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
export default Object.values({Command_Voice});