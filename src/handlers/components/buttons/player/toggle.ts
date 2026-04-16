import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка pause/resume, отвечает за остановку проигрывания или возобновление
 * @class ButtonPlayToggle
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "resume_pause"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonPlayToggle extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const track = queue.tracks.track;

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url} = track;

        // Если плеер уже проигрывает трек
        if (queue.player.status === "player/playing") {
            // Приостанавливаем музыку если она играет
            queue.player.pause();

            // Сообщение о паузе
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.pause", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }

        // Если плеер на паузе
        else if (queue.player.status === "player/pause") {
            // Возобновляем проигрывание если это возможно
            queue.player.resume();

            // Сообщение о возобновлении
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.resume", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }
        return null;
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonPlayToggle];