import {
    Command,
    CommandContext,
    createIntegerOption,
    Declare,
    Locales,
    Middlewares,
    Options,
    SubCommand
} from "seyfert";
import {Colors} from "#structures/discord";
import {MessageFlags} from "seyfert/lib/types";
import {locale} from "#structures";
import {db} from "#app/db";

/**
 * @description Подкоманда для повторного запуска проигрывания
 */
@Declare({
    name: "replay",
    description: "Restart queue!!! Necessary for re-enabling if playback has been completed!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Locales({
    name: [
        ["ru", "заново"],
        ["en-US", "replay"]
    ],
    description: [
        ["ru", "Перезапуск очереди!!! Необходимо для повторного включения если проигрывание было завершено!"],
        ["en-US", "Restart queue!!! Necessary for re-enabling if playback has been completed!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice", "checkQueue"])
class PlayerReplayCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const queue = db.queues.get(ctx.guildId);

        // Переключаем позицию трека на 0
        queue.player.tracks.position = 0;

        // Перезапускаем очередь
        await queue.player.play();
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.play.replay", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}

/**
 * @description Подкоманда для выключения проигрывания музыки
 */
@Declare({
    name: "stop",
    description: "Forced termination of music playback!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Locales({
    name: [
        ["ru", "стоп"],
        ["en-US", "stop"]
    ],
    description: [
        ["ru", "Принудительное завершение проигрывания музыки!"],
        ["en-US", "Forced termination of music playback!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice", "checkQueue"])
class PlayerStopCommand extends SubCommand {
    async run(ctx: CommandContext) {
        // Удаляем очередь
        db.queues.remove(ctx.guildId);
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.play.stop", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    }
}

/**
 * @description Подкоманда для изменения громкости плеера
 */
@Declare({
    name: "volume",
    description: "Change the volume of music playback!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Locales({
    name: [
        ["ru", "громкость"],
        ["en-US", "volume"]
    ],
    description: [
        ["ru", "Изменение громкости проигрывания музыки!"],
        ["en-US", "Change the volume of music playback!"]
    ]
})
@Options({
    value: createIntegerOption({
        name_localizations: {
            "en-US": "value",
            "ru": "значение"
        },
        description_localizations: {
            "en-US": "Player volume value! Range 10-200",
            "ru": "Значение громкости плеера! Диапазон 10-200"
        },
        required: true,
        description: "Player volume value! Range 10-200",
    })
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice", "checkQueue"])
class PlayerVolumeCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const { player } = db.queues.get(ctx.guildId);
        const seek: number = player.audio.current?.duration ?? 0;

        // Изменение громкости
        player.audio.volume = ctx.options["value"];

        // Если можно изменить громкость сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            await player.play(seek);

            // Отправляем сообщение о переключение громкости сейчас
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.value.now", [ctx.member]),
                        color: Colors.Green
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Отправляем сообщение о переключение громкости со следующим треком
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.value.later", [ctx.member]),
                    color: Colors.Green
                }
            ],
            flags: MessageFlags.Ephemeral
        })
    }
}

/**
 * @description Главная команда, идет как группа
 */
@Declare({
    name: "player",
    description: "Player control",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
})
@Locales({
    name: [
        ["ru", "плеер"],
        ["en-US", "player"]
    ],
    description: [
        ["ru", "Управление плеером"],
        ["en-US", "Player control"]
    ]
})
@Options([PlayerReplayCommand, PlayerStopCommand, PlayerVolumeCommand])
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
export default class PlayerCommand extends Command {
    async run() {}
}