import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка stop, отвечает за остановку проигрывания
 * @class ButtonStop
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "stop"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonStop extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Если есть очередь, то удаляем ее
        if (queue) queue.cleanup();

        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.stop"),
                    color: Colors.Green
                }
            ]
        });
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonStop];