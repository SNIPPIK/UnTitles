import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType, VoiceChannel } from "discord.js";
import { Colors } from "#structures/discord";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление голосовыми подключениями
 * @class Command_Voice
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "voice",
        "ru": "голос"
    },
    descriptions: {
        "en-US": "Interaction with voice connections",
        "ru": "Взаимодействие с голосовыми подключениями"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    names: {
        "en-US": "join",
        "ru": "подключение"
    },
    descriptions: {
        "en-US": "Connecting to voice channel!",
        "ru": "Подключение к голосовому каналу или же переподключение к другому!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "channel",
                "ru": "канал"
            },
            descriptions: {
                "en-US": "Options for interacting with the stands!",
                "ru": "Выбор голосового канала"
            },
            required: true,
            type: ApplicationCommandOptionType.Channel,
        }
    ]
})
@CommandOptions({
    names: {
        "en-US": "swap",
        "ru": "смена"
    },
    descriptions: {
        "en-US": "Connecting to voice channel!",
        "ru": "Смена голосового канала или же переподключение к другому!"
    },
    type: ApplicationCommandOptionType.Subcommand,
    options: [
        {
            names: {
                "en-US": "channel",
                "ru": "канал"
            },
            descriptions: {
                "en-US": "Options for interacting with the stands!",
                "ru": "Выбор голосового канала"
            },
            required: true,
            type: ApplicationCommandOptionType.Channel,
        }
    ]
})
@CommandOptions({
    names: {
        "en-US": "leave",
        "ru": "отключение"
    },
    descriptions: {
        "en-US": "Disconnecting from the voice channel!",
        "ru": "Отключение от голосового канала!"
    },
    type: ApplicationCommandOptionType.Subcommand
})
@CommandOptions({
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
})
class Command_Voice extends Assign< BaseCommand<VoiceChannel | string> > {
    public constructor() {
        super({
            permissions: {
                client: ["Connect", "ViewChannel", "SendMessages"]
            },
            middlewares: ["voice", "another_voice"],
            execute: async ({message, type, args}) => {
                const { guild, guildId } = message;

                const voiceConnection = db.voice.get(guildId);
                const queue = db.queues.get(guildId);
                const VoiceChannel = args[0] ?? message.member.voice.channel;

                switch (type) {
                    // Подключение к голосовому каналу
                    case "swap":
                    case "join": {
                        // Если указан не голосовой канал
                        if (typeof VoiceChannel === "string" || VoiceChannel?.type !== 2) {
                            return message.reply({
                                embeds: [
                                    {
                                        color: Colors.Green,
                                        description: locale._(message.locale, "voice.tribune.join.fail")
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если производится попытка подключится к тому же голосовому каналу
                        else if (voiceConnection) {
                            if (voiceConnection.configuration.channel_id === VoiceChannel.id) {
                                return message.reply({
                                    embeds: [
                                        {
                                            color: Colors.Green,
                                            description: locale._(message.locale, "voice.rejoin", [VoiceChannel])
                                        }
                                    ],
                                    flags: "Ephemeral"
                                });
                            }

                            // Смена канала
                            voiceConnection.swapChannel = VoiceChannel.id;
                        }

                        // Подключаемся к голосовому каналу без очереди
                        else if (!queue) {
                            db.voice.join({ channel_id: VoiceChannel.id, guild_id: guild.id, self_deaf: true, self_mute: false }, db.adapter.createVoiceAdapter(guildId));
                        }

                        // Отправляем сообщение о подключении к каналу
                        return message.reply({
                            embeds: [
                                {
                                    color: Colors.Green,
                                    description: locale._(message.locale, "voice.join", [VoiceChannel])
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Отключение от голосового канала
                    case "leave": {
                        // Если есть очередь, то удаляем ее!
                        if (queue) queue.cleanup();

                        // Отключаемся от голосового канала
                        if (!voiceConnection.disconnect) return null;

                        return message.reply({
                            embeds: [
                                {
                                    color: Colors.Green,
                                    description: locale._(message.locale, "voice.leave", [VoiceChannel])
                                }
                            ],
                            flags: "Ephemeral"
                        });
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
                            return message.reply({
                                embeds: [
                                    {
                                        description: args[0] === "join" ? locale._(message.locale, "voice.tribune.join.fail") : locale._(message.locale, "voice.tribune.join.request.fail"),
                                        color: Colors.DarkRed
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Если удалось подключиться или сделать запрос
                        return message.reply({
                            embeds: [
                                {
                                    description: args[0] === "join" ? locale._(message.locale, "voice.tribune.join") : locale._(message.locale, "voice.tribune.join.request"),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
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
export default [Command_Voice];