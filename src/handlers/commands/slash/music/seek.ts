import { Middlewares, Locales, Command, type CommandContext, createStringOption, Declare, Options } from "seyfert";
import { Colors } from "#structures/discord/index.js";
import { MessageFlags } from "discord-api-types/v10";
import { locale } from "#structures";
import { db } from "#db";

/**
 * @description Главная команда, запускает переход времени в треке
 */
@Declare({
    name: "seek",
    description: "Jump to a specific track time!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"],
    defaultMemberPermissions: ["ViewChannel", "SendMessages"]
})
@Options({
    time: createStringOption({
        required: true,
        description: "It is necessary to specify what time to arrive. Example - 00:00",
        name_localizations: {
            "en-US": "time",
            "ru": "время"
        },
        description_localizations: {
            "en-US": "It is necessary to specify what time to arrive. Example - 00:00",
            "ru": "Необходимо указать к какому времени прейти. Пример - 00:00"
        },
    })
})
@Locales({
    name: [
        ["ru", "переход"],
        ["en-US", "seek"]
    ],
    description: [
        ["ru", "Переход к конкретному времени трека!"],
        ["en-US", "Jump to a specific track time!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkQueue", "checkAnotherVoice", "checkPlayerIsPlaying", "checkPlayerWaitStream"])
export default class SeekCommand extends Command {
    async run(ctx: CommandContext<any>) {
        const queue = db.queues.get(ctx.guildId);
        const duration = (ctx.options.time as string)?.duration();

        // Если пользователь написал что-то не так
        if (isNaN(duration)) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.seek.duration.nan"),
                        color: Colors.DarkRed
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если пользователь указал времени больше чем в треке
        else if (duration > queue.tracks.track.time.total || duration <= 0) {
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.seek.duration.big"),
                        color: Colors.DarkRed
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Начинаем проигрывание трека с <пользователем указанного тайм кода>
        queue.player.play(duration).catch(console.error);

        // Отправляем сообщение о пропуске времени
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.seek", [duration]),
                    color: Colors.Green
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}