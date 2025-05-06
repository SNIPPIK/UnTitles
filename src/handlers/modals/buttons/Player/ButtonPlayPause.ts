import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";
import {db} from "@app/db";

class ButtonPlayToggle extends Assign<Button> {
    public constructor() {
        super({
            name: "resume_pause",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если плеер уже проигрывает трек
                if (queue.player.status === "player/playing") {
                    // Приостанавливаем музыку если она играет
                    queue.player.pause();

                    // Сообщение о паузе
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.pause"),
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
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.resume"),
                                color: Colors.Green
                            }
                        ]
                    });
                }
                return null;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonPlayToggle];