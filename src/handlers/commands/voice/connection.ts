import { Command, CommandContext, Declare, Options, SubCommand, Middlewares, Permissions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";


/**
 * @description Подкоманда для подключения к голосовому каналу
 */
@Declare({
    names: {
        "en-US": "join",
        "ru": "подключение"
    },
    descriptions: {
        "en-US": "Connecting to voice channel!",
        "ru": "Подключение к голосовому каналу или же переподключение к другому!"
    }
})
@Options({
    channel: {
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
})
class VoiceJoinCommand extends SubCommand {
    async execute({message, args}: CommandContext) {
        const { guild, guildId } = message;

        const voiceConnection = db.voice.get(guildId);
        const queue = db.queues.get(guildId);
        const VoiceChannel = args[0] ?? message.member.voice.channel;

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
            db.voice.join({ channel_id: VoiceChannel.id, guild_id: guild.id, self_deaf: true, self_mute: false }, db.adapter.voiceAdapterCreator(guildId));
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
}


/**
 * @description Подкоманда для отключения от голосового канала
 */
@Declare({
    names: {
        "en-US": "leave",
        "ru": "отключение"
    },
    descriptions: {
        "en-US": "Disconnecting from the voice channel!",
        "ru": "Отключение от голосового канала!"
    }
})
class VoiceLeaveCommand extends SubCommand {
    async execute({message, args}: CommandContext) {
        const { guildId } = message;

        const voiceConnection = db.voice.get(guildId);
        const queue = db.queues.get(guildId);
        const VoiceChannel = args[0] ?? message.member.voice.channel;

        /// Если есть очередь, то удаляем ее!
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
}


/**
 * @description Подкоманда для подключения или запроса доступа к трибуне
 */
@Declare({
    names: {
        "en-US": "tribune",
        "ru": "трибуна"
    },
    descriptions: {
        "en-US": "Request to broadcast music to the podium!",
        "ru": "Запрос на транслирование музыки в трибуну!"
    }
})
@Options({
    tribune: {
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
})
class VoiceTribuneCommand extends SubCommand {
    async execute({message, args}: CommandContext) {
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


/**
 * @description Главная команда, идет как группа
 */
@Declare({
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
@Options([VoiceJoinCommand, VoiceLeaveCommand, VoiceTribuneCommand])
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class VoiceControllerCommand extends Command {
    async execute() {}
}


/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [VoiceControllerCommand];