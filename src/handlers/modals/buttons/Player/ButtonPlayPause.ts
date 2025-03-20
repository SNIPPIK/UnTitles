import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonPlayToggle extends Assign<Button> {
    public constructor() {
        super({
            name: "resume_pause",
            callback: (msg) => {
                const queue = msg.queue;

                // Если плеер уже проигрывает трек
                if (queue.player.status === "player/playing") {
                    // Приостанавливаем музыку если она играет
                    queue.player.pause();

                    // Сообщение о паузе
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.pause"),
                        color: Colors.Green
                    };
                }

                // Если плеер на паузе
                else if (queue.player.status === "player/pause") {
                    // Возобновляем проигрывание если это возможно
                    queue.player.resume();

                    // Сообщение о возобновлении
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.resume"),
                        color: Colors.Green
                    };
                }
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ButtonPlayToggle});