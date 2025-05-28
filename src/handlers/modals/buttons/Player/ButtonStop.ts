import {locale} from "#service/locale";
import {Button} from "#handler/modals";
import {Colors} from "discord.js";
import {Assign} from "#utils";
import {db} from "#app/db";

class ButtonStop extends Assign<Button> {
    public constructor() {
        super({
            name: "stop",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если есть очередь, то удаляем ее
                if (queue) queue.cleanup();

                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.stop"),
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
export default [ButtonStop];