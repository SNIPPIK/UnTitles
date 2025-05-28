import {locale} from "#service/locale";
import {Button} from "#handler/modals";
import {Colors} from "discord.js";
import {Assign} from "#utils";
import {db} from "#app/db";

class ButtonShuffle extends Assign<Button> {
    public constructor() {
        super({
            name: "shuffle",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);

                // Если в очереди менее 2 треков
                if (queue.tracks.size < 2) {
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.shuffle.fail"),
                                color: Colors.Yellow
                            }
                        ]
                    });
                }

                // Включение тасовки очереди
                queue.tracks.shuffle = !queue.tracks.shuffle;

                // Отправляем сообщение о включении или выключении тасовки
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, queue.tracks.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
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
export default [ButtonShuffle];