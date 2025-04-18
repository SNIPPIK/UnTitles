import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonReplay extends Assign<Button> {
    public constructor() {
        super({
            name: "replay",
            callback: (msg) => {
                const queue = msg.queue;

                // Запускаем проигрывание текущего трека
                queue.player.play(0, queue.tracks.position);

                // Сообщаем о том что музыка начата с начала
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.replay", [queue.tracks.track.name]),
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
export default Object.values({ButtonReplay});