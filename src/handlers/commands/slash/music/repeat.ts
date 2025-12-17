import { Command, CommandContext, Declare, Middlewares, Options, Permissions } from "#handler/commands";
import { ApplicationCommandOptionType, Colors } from "discord.js";
import { RepeatType } from "#core/queue";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Команда для управления повтором очереди!
 * @class RepeatCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "repeat",
        "ru": "повтор"
    },
    descriptions: {
        "en-US": "Switch the repeat type to any position!",
        "ru": "Переключение типа повтора в любую позицию!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@Options({
    type: {
        names: {
            "en-US": "type",
            "ru": "тип"
        },
        descriptions: {
            "en-US": "Select a repeat type!",
            "ru": "Выберите тип повтора!"
        },
        type: ApplicationCommandOptionType["String"],
        required: true,
        choices: [
            {
                name: "song",
                nameLocalizations: {
                    "en-US": "song",
                    "ru": "трек"
                },
                value: `${RepeatType.Song}`
            },
            {
                name: "songs",
                nameLocalizations: {
                    "en-US": "songs",
                    "ru": "треки"
                },
                value: `${RepeatType.Songs}`
            },
            {
                name: "autoplay",
                nameLocalizations: {
                    "en-US": "autoplay",
                    "ru": "похожее"
                },
                value: `${RepeatType.AutoPlay}`
            },
            {
                name: "off",
                nameLocalizations: {
                    "en-US": "off",
                    "ru": "выкл"
                },
                value: `${RepeatType.None}`
            },
        ]
    }
})
@Middlewares(["cooldown", "queue", "voice", "another_voice", "player-not-playing", "player-wait-stream"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class RepeatCommand extends Command {
    async run({ctx, args}: CommandContext) {
        const queue = db.queues.get(ctx.guildId), loop = parseInt(args[0]) as RepeatType;

        // Смотрим тип повтора
        switch (loop) {
            // Выключение повтора
            case RepeatType.None: {
                queue.tracks.repeat = RepeatType.None;
                return ctx.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(ctx.locale, "player.button.repeat.off"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение повтора 1 трека
            case RepeatType.Song: {
                queue.tracks.repeat = RepeatType.Song;

                return ctx.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(ctx.locale, "player.button.repeat.song"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение повтора треков
            case RepeatType.Songs: {
                queue.tracks.repeat = RepeatType.Songs;

                return ctx.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(ctx.locale, "player.button.repeat.songs"),
                            color: Colors.Green
                        }
                    ]
                });
            }

            // Включение autoplay функции
            case RepeatType.AutoPlay: {
                queue.tracks.repeat = RepeatType.AutoPlay;

                return ctx.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(ctx.locale, "player.button.repeat.related"),
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

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [RepeatCommand];