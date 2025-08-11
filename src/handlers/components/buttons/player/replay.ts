import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка replay, отвечает за проигрывание заново
 * @class ButtonReplay
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "replay"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonReplay extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Запускаем проигрывание текущего трека
        queue.player.play(0, 0, queue.player.tracks.position).catch(console.error);

        // Сообщаем о том что музыка начата с начала
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.replay", [queue.tracks.track.name]),
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
export default [ButtonReplay];