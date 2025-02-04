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
        }
    ],
    dm_permission: false
})
class Command_Voice extends Assign<Command> {
    public constructor() {
        super({
            rules: ["voice", "another_voice"],
            execute: ({message, type}) => {
                const { guild } = message;
                const VoiceChannel = message.voice.channel;
                const voiceConnection = db.voice.get(guild.id);
                const queue = message.queue;

                switch (type) {

                    // Подключение к голосовому каналу
                    case "join": {
                        // Бот в том же голосовом канале
                        if (voiceConnection && voiceConnection.config.channelId === VoiceChannel.id) return;

                        // Подключаемся к голосовому каналу
                        const voice = db.voice.join({
                            channelId: VoiceChannel.id,
                            guildId: guild.id,
                            selfDeaf: true,
                            selfMute: true
                        }, guild.voiceAdapterCreator);

                        new message.builder().addEmbeds([
                            {
                                color: Colors.Green,
                                description: locale._(message.locale, "voice.join", [VoiceChannel])
                            }
                        ]).setTime(10e3).send = message;
                        return;
                    }

                    // Переконфигурация голосового канала
                    case "re-configure": {
                        // Меняем регион голосового подключения
                        VoiceChannel.setRTCRegion(null, 'Auto select channel region')
                            .then(() => {
                                //Перенастройка подключения
                                voiceConnection.configureSocket();

                                new message.builder().addEmbeds([
                                    {
                                        color: Colors.Green,
                                        description: locale._(message.locale, "voice.rtc")
                                    }
                                ]).setTime(10e3).send = message;
                            })
                            .catch(() => {
                                new message.builder().addEmbeds([
                                    {
                                        color: Colors.DarkRed,
                                        description: locale._(message.locale, "voice.rtc.fail")
                                    }
                                ]).setTime(10e3).send = message;
                            });
                        return;
                    }

                    // Отключение от голосового канала
                    case "leave": {
                        // Если есть очередь, то удаляем ее!
                        if (queue) queue.cleanup();

                        // Отключаемся от голосового канала
                        voiceConnection.disconnect();
                        new message.builder().addEmbeds([
                            {
                                color: Colors.Green,
                                description: locale._(message.locale, "voice.leave", [VoiceChannel])
                            }
                        ]).setTime(10e3).send = message;
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