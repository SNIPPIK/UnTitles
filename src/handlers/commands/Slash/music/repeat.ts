import {Command, CommandContext, createStringOption, Declare, Locales, Middlewares, Options} from "seyfert";
import {MessageFlags} from "seyfert/lib/types";
import {Colors} from "#structures/discord";
import {RepeatType} from "#core/queue";
import {locale} from "#structures";
import {db} from "#app/db";

/**
 * @author SNIPPIK
 * @description Команда для управления повтором очереди!
 * @class RepeatCommand
 * @extends Command
 * @public
 */
@Declare({
    name: "repeat",
    description: "Switch the repeat type to any position!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "ViewChannel"]
})
@Options({
    type: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "type",
            "ru": "тип"
        },
        description: "Select a repeat type!",
        description_localizations: {
            "en-US": "Select a repeat type!",
            "ru": "Выберите тип повтора!"
        },
        choices: [
            {
                name: "song",
                name_localizations: {
                    "en-US": "song",
                    "ru": "трек"
                },
                value: `${RepeatType.Song}`
            },
            {
                name: "songs",
                name_localizations: {
                    "en-US": "songs",
                    "ru": "треки"
                },
                value: `${RepeatType.Songs}`
            },
            {
                name: "autoplay",
                name_localizations: {
                    "en-US": "autoplay",
                    "ru": "похожее"
                },
                value: `${RepeatType.AutoPlay}`
            },
            {
                name: "off",
                name_localizations: {
                    "en-US": "off",
                    "ru": "выкл"
                },
                value: `${RepeatType.None}`
            }
        ]
    })
})
@Middlewares([
    "userVoiceChannel",
    "clientVoiceChannel",
    "checkAnotherVoice"
])
@Locales({
    name: [
        ["ru", "повтор"],
        ["en-US", "repeat"]
    ],
    description: [
        ["ru", "Переключение типа повтора в любую позицию!"],
        ["en-US", "Switch the repeat type to any position!"]
    ]
})
export default class RepeatCommand extends Command {
    async run(ctx: CommandContext) {
        const queue = db.queues.get(ctx.guildId), loop = parseInt(ctx.options["type"]) as RepeatType;

        // Смотрим тип повтора
        switch (loop) {
            // Выключение повтора
            case RepeatType.None: {
                queue.tracks.repeat = RepeatType.None;
                return ctx.write({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "player.button.repeat.off"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение повтора 1 трека
            case RepeatType.Song: {
                queue.tracks.repeat = RepeatType.Song;

                return ctx.write({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "player.button.repeat.song"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение повтора треков
            case RepeatType.Songs: {
                queue.tracks.repeat = RepeatType.Songs;

                return ctx.write({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "player.button.repeat.songs"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение autoplay функции
            case RepeatType.AutoPlay: {
                queue.tracks.repeat = RepeatType.AutoPlay;

                return ctx.write({
                    flags: MessageFlags.Ephemeral,
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "player.button.repeat.related"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Если что-то пошло не так
            default: return null;
        }
    }
}