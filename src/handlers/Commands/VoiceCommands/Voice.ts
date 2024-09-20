import {ApplicationCommandOptionType, Colors, StageChannel, VoiceChannel} from "discord.js";
import {SlashBuilder} from "@lib/discord/utils/SlashBuilder";
import {Constructor, Handler} from "@handler";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @class Command_Voice
 * @command voice
 * @description Управление голосовыми подключениями
 */
class Command_Voice extends Constructor.Assign<Handler.Command> {
    public constructor() {
        super({
            data: new SlashBuilder()
                .setName("voice")
                .setDescription("Взаимодействие с голосовыми подключениями")
                .setDescriptionLocale({
                    "en-US": "Interaction with voice connections"
                })
                .addSubCommands([
                    {
                        name: "leave",
                        description: "Отключение от голосового канала!",
                        descriptionLocalizations: {
                            "en-US": "Disconnecting from the voice channel!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    },
                    {
                        name: "re-configure",
                        description: "Переподключение к голосовому каналу!",
                        descriptionLocalizations: {
                            "en-US": "Reconnect to the voice channel!"
                        },
                        type: ApplicationCommandOptionType.Subcommand
                    }
                ]).json,
            execute: async ({message, type}) => {
                const { author, member, guild } = message;
                const VoiceChannel: VoiceChannel | StageChannel = message.voice.channel;
                const queue = db.audio.queue.get(guild.id);

                switch (type) {

                    // Переконфигурация голосового канала
                    case "re-configure": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return;

                        // Меняем регион голосового подключения
                        VoiceChannel.setRTCRegion(null, 'Auto select channel region')
                            .then(() => {
                                //Перенастройка подключения
                                voiceConnection.configureSocket();

                                new message.builder().addEmbeds([
                                    {
                                        color: Colors.Green,
                                        description: "Change RTC region!"
                                    }
                                ]).setTime(10e3).send = message;
                            })
                            .catch(() => {
                                new message.builder().addEmbeds([
                                    {
                                        color: Colors.DarkRed,
                                        description: "Fail change RTC region!"
                                    }
                                ]).setTime(10e3).send = message;
                            });
                        return;
                    }

                    // Отключение от голосового канала
                    case "leave": {
                        const voiceConnection = Voice.get(guild.id);

                        //Если бот не подключен к голосовому каналу
                        if (!voiceConnection) return;

                        voiceConnection.disconnect();

                        new message.builder().addEmbeds([
                            {
                                color: Colors.Green,
                                description: "Success to leave voice channel!"
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