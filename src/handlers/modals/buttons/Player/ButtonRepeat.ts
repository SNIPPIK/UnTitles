import {RepeatType} from "@service/player";
import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";
import {db} from "@app/db";

class ButtonRepeat extends Assign<Button> {
    public constructor() {
        super({
            name: "repeat",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id), loop = queue.tracks.repeat;

                // Включение всех треков
                if (loop === RepeatType.None) {
                    queue.tracks.repeat = RepeatType.Songs;

                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.repeat.songs"),
                                color: Colors.Green
                            }
                        ]
                    });
                }

                // Включение повтора трека
                else if (loop === RepeatType.Songs) {
                    queue.tracks.repeat = RepeatType.Song;

                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.repeat.song"),
                                color: Colors.Green
                            }
                        ]
                    });
                }

                queue.tracks.repeat = RepeatType.None;

                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.repeat.off"),
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
export default [ButtonRepeat];