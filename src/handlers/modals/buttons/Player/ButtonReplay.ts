import {locale} from "#service/locale";
import {Button} from "#handler/modals";
import {Colors} from "discord.js";
import {Assign} from "#utils";
import {db} from "#app/db";

class ButtonReplay extends Assign<Button> {
    public constructor() {
        super({
            name: "replay",
            callback: async (message) => {
                const queue = db.queues.get(message.guild.id);

                // Запускаем проигрывание текущего трека
                await queue.player.play(0, queue.player.tracks.position);

                // Сообщаем о том что музыка начата с начала
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.replay", [queue.tracks.track.name]),
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
export default [ButtonReplay];