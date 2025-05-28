import {locale} from "#service/locale";
import {Button} from "#handler/modals";
import {Colors} from "discord.js";
import {Assign} from "#utils";
import {db} from "#app/db";

class ButtonSkip extends Assign<Button> {
    public constructor() {
        super({
            name: "skip",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);

                // Меняем позицию трека в очереди
                queue.player.stop(queue.tracks.position + 1);

                // Уведомляем пользователя о пропущенном треке
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.skip"),
                            color: Colors.Green
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonSkip];