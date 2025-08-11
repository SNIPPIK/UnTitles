import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { RepeatType } from "#core/queue";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка back, отвечает за возврат к прошлому треку
 * @class ButtonBack
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "back"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonBack extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const repeat = queue.tracks.repeat;
        const position = queue.tracks.position;

        // Делаем повтор временным
        if (repeat === RepeatType.None) queue.tracks.repeat = RepeatType.Songs;

        // Если позиция меньше или равна 0
        if (position <= 0) {
            // Переключаем на 0 позицию
            queue.tracks.position = queue.tracks.total - 1;

            // Переключаемся на последний трек
            queue.player.play(0, 0, queue.tracks.position).catch(console.error);
        }

        else {
            // Переключаемся на прошлый трек
            queue.player.play(0, 0, position - 1).catch(console.error);
        }

        // Возвращаем повтор
        queue.tracks.repeat = repeat;

        // Уведомляем пользователя о смене трека
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.last"),
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
export default [ButtonBack];