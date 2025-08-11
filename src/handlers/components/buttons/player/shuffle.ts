import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка shuffle, отвечает за перетасовку треков
 * @class ButtonShuffle
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "shuffle"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonShuffle extends Component<"button"> {
    public callback: Component<"button">["callback"] = (ctx) => {
        const queue = db.queues.get(ctx.guildId);

        // Если в очереди менее 2 треков
        if (queue.tracks.size < 2) {
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.shuffle.fail"),
                        color: Colors.Yellow
                    }
                ]
            });
        }

        // Включение тасовки очереди
        queue.tracks.shuffleTracks(!queue.tracks.shuffle);

        // Отправляем сообщение о включении или выключении тасовки
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
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
export default [ButtonShuffle];