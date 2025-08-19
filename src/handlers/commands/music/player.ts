import { Command, CommandContext, Declare, Middlewares, Options, SubCommand, Permissions } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";


/**
 * @description Подкоманда для повторного запуска проигрывания
 */
@Declare({
    names: {
        "en-US": "replay",
        "ru": "заново"
    },
    descriptions: {
        "en-US": "Restart queue!!! Necessary for re-enabling if playback has been completed!",
        "ru": "Перезапуск очереди!!! Необходимо для повторного включения если проигрывание было завершено!"
    }
})
class PlayerReplay extends SubCommand {
    async run({ctx}: CommandContext<string>) {
        const queue = db.queues.get(ctx.guild.id);

        // Переключаем позицию трека на 0
        queue.player.tracks.position = 0;

        // Перезапускаем очередь
        db.queues.restart_player = queue.player;
        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.play.replay", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: "Ephemeral"
        });
    }
}

/**
 * @description Подкоманда для выключения проигрывания музыки
 */
@Declare({
    names: {
        "en-US": "stop",
        "ru": "стоп"
    },
    descriptions: {
        "en-US": "Forced termination of music playback!",
        "ru": "Принудительное завершение проигрывания музыки!"
    }
})
class PlayerStop extends SubCommand {
    async run({ctx}: CommandContext<string>) {
        // Удаляем очередь
        db.queues.remove(ctx.guildId);

        // Отправляем сообщение
        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.play.stop", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: "Ephemeral"
        });
    };
}

/**
 * @description Подкоманда для изменения громкости плеера
 */
@Declare({
    names: {
        "en-US": "volume",
        "ru": "громкость"
    },
    descriptions: {
        "en-US": "Change the volume of music playback!",
        "ru": "Изменение громкости проигрывания музыки!"
    }
})
@Options({
    value: {
        names: {
            "en-US": "value",
            "ru": "значение"
        },
        descriptions: {
            "en-US": "Значение громкости плеера! Диапазон 10-200",
            "ru": "Player volume value! Range 10-200"
        },
        required: true,
        type: ApplicationCommandOptionType["String"]
    }
})
class PlayerVolume extends SubCommand {
    async run({ctx, args}: CommandContext) {
        const { player } = db.queues.get(ctx.guildId);

        // Изменение громкости
        player.volume = parseInt(args[0]);

        // Если можно изменить громкость сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.play(player.audio.current.duration).catch(console.error);

            // Отправляем сообщение о переключение громкости сейчас
            return ctx.reply({
                embeds: [
                    {
                        description: locale._(ctx.locale, "command.value.now", [ctx.member]),
                        color: Colors.Green
                    }
                ],
                flags: "Ephemeral"
            });
        }

        // Отправляем сообщение о переключение громкости со следующим треком
        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.value.later", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: "Ephemeral"
        })
    }
}

/**
 * @author SNIPPIK
 * @description Расширенное включение музыки
 * @class PlayerController
 * @extends Command
 * @public
 */
@Declare({
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
@Options([PlayerReplay, PlayerStop, PlayerVolume])
@Middlewares(["cooldown", "queue", "voice", "another_voice"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class PlayerController extends Command {
    async run() {}
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ PlayerController ];