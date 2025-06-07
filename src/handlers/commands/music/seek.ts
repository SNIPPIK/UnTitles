import { BaseCommand, SlashCommand, SlashCommandSubCommand } from "#handler/commands";
import { ApplicationCommandOptionType, Colors } from "discord.js";
import { locale } from "#service/locale";
import { Assign } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Управление временем, дает возможность пропускать время в треке
 * @class SeekTrackCommand
 * @extends Assign
 * @public
 */
@SlashCommand({
    names: {
        "en-US": "seek",
        "ru": "переход"
    },
    descriptions: {
        "en-US": "Jump to a specific track time!",
        "ru": "Переход к конкретному времени трека!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@SlashCommandSubCommand({
    type: ApplicationCommandOptionType["String"],
    names: {
        "en-US": "time",
        "ru": "время"
    },
    descriptions: {
        "en-US": "It is necessary to specify what time to arrive. Example - 00:00",
        "ru": "Необходимо указать к какому времени прейти. Пример - 00:00"
    },
    required: true,
})
class SeekTrackCommand extends Assign< BaseCommand > {
    public constructor() {
        super({
            permissions: {
                client: ["ViewChannel", "SendMessages"]
            },
            middlewares: ["queue", "voice", "another_voice", "player-not-playing"],
            execute: async ({message, args}) => {
                const queue = db.queues.get(message.guildId);
                const duration = args[0]?.duration();

                // Если пользователь написал что-то не так
                if (isNaN(duration)) {
                    return message.reply({
                        embeds: [
                            {
                                color: Colors.DarkRed,
                                description: locale._(message.locale, "command.seek.duration.nan")
                            }
                        ],
                        flags: "Ephemeral"
                    });
                }

                // Если пользователь указал времени больше чем в треке
                else if (duration > queue.tracks.track.time.total) {
                    return message.reply({
                        embeds: [
                            {
                                color: Colors.DarkRed,
                                description: locale._(message.locale, "command.seek.duration.big")
                            }
                        ],
                        flags: "Ephemeral"
                    });
                }

                // Начинаем проигрывание трека с <пользователем указанного тайм кода>
                await queue.player.play(duration);

                // Отправляем сообщение о пропуске времени
                return message.reply({
                    embeds: [
                        {
                            color: Colors.Green,
                            description: locale._(message.locale, "command.seek", [duration])
                        }
                    ],
                    flags: "Ephemeral"
                });
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [SeekTrackCommand];