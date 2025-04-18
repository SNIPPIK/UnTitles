import {RepeatType} from "@service/player";
import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonBack extends Assign<Button> {
    public constructor() {
        super({
            name: "back",
            callback: (msg) => {
                const queue = msg.queue;
                const repeat = queue.tracks.repeat;

                // Делаем повтор временным
                if (repeat === RepeatType.None) queue.tracks.repeat = RepeatType.Songs;

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position - 1);

                // Возвращаем повтор
                queue.tracks.repeat = repeat;

                // Уведомляем пользователя о смене трека
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.last"),
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
export default Object.values({ButtonBack});