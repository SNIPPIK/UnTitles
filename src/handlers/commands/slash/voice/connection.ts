import { Command, SubCommand, createChannelOption, Declare, Options, Middlewares, CommandContext, createStringOption, Locales } from "seyfert";
import { Colors } from "#structures/discord";
import { MessageFlags, ChannelType } from "seyfert/lib/types";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Подкоманда для подключения к голосовому каналу
 */
@Declare({
    name: "join",
    description: "Connecting to voice channel!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
@Options({
    voice: createChannelOption({
        channel_types: [ChannelType.GuildVoice, ChannelType.GuildStageVoice],
        name_localizations: {
            "en-US": "channel",
            "ru": "канал"
        },
        description_localizations: {
            "en-US": "Options for interacting with the stands!",
            "ru": "Выбор голосового канала"
        },
        description: "Options for interacting with the stands!",
        required: true
    })
})
@Locales({
    name: [
        ["ru", "подключение"],
        ["en-US", "join"]
    ],
    description: [
        ["ru", "Подключение к голосовому каналу или же переподключение к другому!"],
        ["en-US", "Connecting to voice channel!"]
    ]
})
class VoiceJoinCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const voiceConnection = db.voice.get(ctx.guildId);
        const VoiceChannel = ctx.options["voice"];
        const queue = db.queues.get(ctx.guildId);

        // Если указан не голосовой канал
        if (typeof VoiceChannel === "string" || VoiceChannel?.type !== 2) {
            return ctx.write({
                embeds: [
                    {
                        color: Colors.Green,
                        description: locale._(ctx.interaction.locale, "voice.tribune.join.fail")
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если производится попытка подключится к тому же голосовому каналу
        else if (voiceConnection) {
            if (voiceConnection.configuration.channel_id === VoiceChannel.id) {
                return ctx.write({
                    embeds: [
                        {
                            color: Colors.Green,
                            description: locale._(ctx.interaction.locale, "voice.rejoin", [VoiceChannel])
                        }
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Смена канала
            voiceConnection.channel = VoiceChannel.id;
        }

        // Подключаемся к голосовому каналу без очереди
        else if (!queue) {
            db.voice.join({ channel_id: VoiceChannel.id, guild_id: ctx.guildId, self_deaf: true, self_mute: false }, db.adapter.voiceAdapterCreator(ctx.guildId));
        }

        // Отправляем сообщение о подключении к каналу
        return ctx.write({
            embeds: [
                {
                    color: Colors.Green,
                    description: locale._(ctx.interaction.locale, "voice.join", [VoiceChannel])
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}


/**
 * @description Подкоманда для отключения от голосового канала
 */
@Declare({
    name: "leave",
    description: "Disconnecting from the voice channel",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
@Locales({
    name: [
        ["ru", "отключение"],
        ["en-US", "leave"]
    ],
    description: [
        ["ru", "Отключение от голосового канала!"],
        ["en-US", "Disconnecting from the voice channel"]
    ]
})
class VoiceLeaveCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const voiceConnection = db.voice.get(ctx.guildId);
        const VoiceChannel = ctx.options["voice"];
        const queue = db.queues.get(ctx.guildId);

        // Если есть очередь, то удаляем ее!
        if (queue) queue.cleanup();

        // Отключаемся от голосового канала
        if (!voiceConnection.disconnect) return null;

        return ctx.write({
            embeds: [
                {
                    color: Colors.Green,
                    description: locale._(ctx.interaction.locale, "voice.leave", [VoiceChannel])
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}


/**
 * @description Подкоманда для подключения или запроса доступа к трибуне
 */
@Declare({
    name: "tribune",
    description: "Request or join to broadcast music to the tribune!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
@Options({
    type: createStringOption({
        name_localizations: {
            "en-US": "choice",
            "ru": "выбор"
        },
        description_localizations: {
            "en-US": "Options for interacting with the stands!",
            "ru": "Варианты взаимодействия с трибунами"
        },
        description: "Options for interacting with the stands!",
        required: true,
        choices: [
            {
                name: "join - Connecting to the podium",
                nameLocalizations: {
                    "en-US": "join - Connecting to the podium",
                    "ru": "join - Подключение к трибуне"
                },
                value: "join"
            },
            {
                name: "request - Connection request",
                nameLocalizations: {
                    "en-US": "request - Connection request",
                    "ru": "request - Запрос на подключение"
                },
                value: "request"
            }
        ]
    })
})
@Locales({
    name: [
        ["ru", "трибуна"],
        ["en-US", "tribune"]
    ],
    description: [
        ["ru", "Варианты взаимодействия с трибунами!"],
        ["en-US", "Request to broadcast music to the tribune!"]
    ]
})
class VoiceTribuneCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const me = ctx.me("cache");
        const type = ctx.options["type"] as "join" | "request";

        try {
            // Если бота просят подключится
            if (type === "join") await me.voice("cache").setSuppress(true);

            // Если бота просят сделать запрос
            else await me.voice("cache").requestSpeak();
        } catch (err) {
            // Если не удалось подключиться или сделать запрос
            return ctx.write({
                embeds: [
                    {
                        description: type === "join" ? locale._(ctx.interaction.locale, "voice.tribune.join.fail") : locale._(ctx.interaction.locale, "voice.tribune.join.request.fail"),
                        color: Colors.DarkRed
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если удалось подключиться или сделать запрос
        return ctx.write({
            embeds: [
                {
                    description: type === "join" ? locale._(ctx.interaction.locale, "voice.tribune.join") : locale._(ctx.interaction.locale, "voice.tribune.join.request"),
                    color: Colors.Green
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}


/**
 * @description Главная команда, идет как группа
 */
@Declare({
    name: "voice",
    description: "Interaction with voice connections",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
})
@Options([VoiceJoinCommand, VoiceLeaveCommand, VoiceTribuneCommand])
@Locales({
    name: [
        ["ru", "голос"],
        ["en-US", "voice"]
    ],
    description: [
        ["ru", "Взаимодействие с голосовыми подключениями"],
        ["en-US", "Interaction with voice connections"]
    ]
})
export default class VoiceCommand extends Command {
    async run() {}
}