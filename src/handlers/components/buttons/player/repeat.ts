import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { RepeatType } from "#core/queue";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка repeat, отвечает за переключение режима повтора
 * @class ButtonRepeat
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "repeat"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonRepeat extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId), loop = queue.tracks.repeat;

        // Включение всех треков
        if (loop === RepeatType.None) {
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

        // Включение повтора трека
        else if (loop === RepeatType.Songs) {
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
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonRepeat];