import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonStop extends Assign<Button> {
    public constructor() {
        super({
            name: "stop",
            callback: (msg) => {
                const queue = msg.queue;

                // Если есть очередь, то удаляем ее
                if (queue) queue.cleanup();

                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.stop"),
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
export default Object.values({ButtonStop});