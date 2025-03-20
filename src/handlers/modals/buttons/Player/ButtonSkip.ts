import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonSkip extends Assign<Button> {
    public constructor() {
        super({
            name: "skip",
            callback: (msg) => {
                const queue = msg.queue;

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position + 1);

                // Уведомляем пользователя о пропущенном треке
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.skip"),
                    color: Colors.Green
                };
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ButtonSkip});