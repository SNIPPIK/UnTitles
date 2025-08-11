import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка skip, отвечает за пропуск текущего трека
 * @class ButtonSkip
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "skip"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonSkip extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const position = queue.tracks.position;

        // Если позиция больше чем есть треков
        if (position >= queue.tracks.total - 1) {
            // Переключаем на 0 позицию
            queue.tracks.position = 0;

            // Переключаемся на первый трек
            queue.player.play(0, 0, 0).catch(console.error);
        }

        else {
            // Переключаемся вперед
            queue.player.play(0, 0, position + 1).catch(console.error);
        }

        // Уведомляем пользователя о пропущенном треке
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.skip"),
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
export default [ButtonSkip];