import {ApplicationCommandOptionType, Colors, StageChannel, VoiceChannel} from "discord.js";
import {SlashBuilder} from "@util/decorators/SlashCommand";
import {Constructor, Handler} from "@handler";
import {locale} from "@service/locale";
import {db} from "@service/db";

/**
 * @author SNIPPIK
 * @description Управление голосовыми подключениями
 * @class Command_Voice
 * @public
 */
@SlashBuilder({
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
class Command_Voice extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            rules: ["voice", "another_voice"],
            execute: ({message, type}) => {
                const VoiceChannel: VoiceChannel | StageChannel = message.voice.channel;
                const { guild } = message;
                const voiceConnection = db.voice.get(guild.id);
                const queue = message.queue;

                switch (type) {

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