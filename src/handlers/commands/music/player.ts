import { BaseCommand, CommandDeclare, CommandOptions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Colors } from "#structures/discord";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Расширенное включение музыки
 * @class PlayControl
 * @extends Assign
 * @public
 */
@CommandDeclare({
    names: {
        "en-US": "player",
        "ru": "плеер"
    },
    descriptions: {
        "en-US": "Advanced control of music inclusion!",
        "ru": "Расширенное управление включение музыки!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "replay",
        "ru": "заново"
    },
    descriptions: {
        "en-US": "Restart queue!!! Necessary for re-enabling if playback has been completed!",
        "ru": "Перезапуск очереди!!! Необходимо для повторного включения если проигрывание было завершено!"
    },
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "stop",
        "ru": "стоп"
    },
    descriptions: {
        "en-US": "Forced termination of music playback!",
        "ru": "Принудительное завершение проигрывания музыки!"
    }
})
@CommandOptions({
    type: ApplicationCommandOptionType.Subcommand,
    names: {
        "en-US": "volume",
        "ru": "громкость"
    },
    descriptions: {
        "en-US": "Forced termination of music playback!",
        "ru": "Принудительное завершение проигрывания музыки!"
    },
})
class PlayerControl extends Assign<BaseCommand> {
    public constructor() {
        super({
            middlewares: ["voice", "another_voice", "queue"],
            permissions: {
                client: ["Connect", "SendMessages", "Speak", "ViewChannel"]
            },
            execute: async ({message, args, type}) => {
                switch (type) {
                    // Если надо перезапустить проигрывание
                    case "replay": {
                        const queue = db.queues.get(message.guild.id);

                        // Переключаем позицию трека на 0
                        queue.player.tracks.position = 0;

                        // Перезапускаем очередь
                        db.queues.restart_player = queue.player;
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.play.replay", [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Принудительное завершение проигрывания музыки
                    case "stop": {
                        // Удаляем очередь
                        db.queues.remove(message.guildId);
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.play.stop", [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        });
                    }

                    // Принудительное завершение проигрывания музыки
                    case "volume": {
                        const { player } = db.queues.get(message.guildId);

                        // Изменение громкости
                        player.volume = parseInt(args[0]);

                        // Если можно изменить громкость сейчас
                        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                            player.play(player.audio.current.duration).catch(console.error);

                            // Отправляем сообщение о переключение громкости сейчас
                            return message.reply({
                                embeds: [
                                    {
                                        description: locale._(message.locale, "command.value.now", [message.member]),
                                        color: Colors.Green
                                    }
                                ],
                                flags: "Ephemeral"
                            });
                        }

                        // Отправляем сообщение о переключение громкости со следующим треком
                        return message.reply({
                            embeds: [
                                {
                                    description: locale._(message.locale, "command.value.later", [message.member]),
                                    color: Colors.Green
                                }
                            ],
                            flags: "Ephemeral"
                        })
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
export default [ PlayerControl ];