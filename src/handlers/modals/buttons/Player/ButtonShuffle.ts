import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonShuffle extends Assign<Button> {
    public constructor() {
        super({
            name: "shuffle",
            callback: (msg) => {
                const queue = msg.queue;

                // Если в очереди менее 2 треков
                if (queue.tracks.size < 2) {
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.shuffle.fail"),
                        color: Colors.Yellow
                    };
                    return;
                }

                // Включение тасовки очереди
                queue.tracks.shuffle = !queue.tracks.shuffle;

                // Отправляем сообщение о включении или выключении тасовки
                msg.FBuilder = {
                    description: locale._(msg.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
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
export default Object.values({ButtonShuffle});