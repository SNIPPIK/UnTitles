import {ApplicationCommandOptionType, Colors, StageChannel, VoiceChannel} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {Voice} from "@lib/voice";

/**
 * @class Command_Voice
 * @command voice
 * @description Управление голосовыми подключениями
 */
class Command_Voice extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName({
                    "en-US": "voice",
                    "ru": "голос"
                })
                .setDescription({
                    "en-US": "Interaction with voice connections",
                    "ru": "Взаимодействие с голосовыми подключениями"
                })
                .addSubCommands([
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
                ]).json,
            rules: ["voice", "another_voice"],
            execute: async ({message, type}) => {
                const VoiceChannel: VoiceChannel | StageChannel = message.voice.channel;
                const queue = message.queue;
                const { guild } = message;

                switch (type) {

                    // Переконфигурация голосового канала
                    case "re-configure": {
                        const voiceConnection = Voice.get(guild.id);

                        // Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return;

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
                        const voiceConnection = Voice.get(guild.id);

                        // Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return;

                        // Если есть очередь, то удаляем ее!
                        if (queue) queue.cleanup();

                        voiceConnection.disconnect();

                        new message.builder().addEmbeds([
                            {
                                color: Colors.Green,
                                description: locale._(message.locale, "voice.leave")
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
 * @description Делаем классы глобальными
 */
export default Object.values({Command_Voice});