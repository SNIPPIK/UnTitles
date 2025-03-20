import {RepeatType} from "@service/player";
import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonRepeat extends Assign<Button> {
    public constructor() {
        super({
            name: "repeat",
            callback: (msg) => {
                const queue = msg.queue, loop = queue.tracks.repeat;

                // Включение всех треков
                if (loop === RepeatType.None) {
                    queue.tracks.repeat = RepeatType.Songs;

                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.songs"),
                        color: Colors.Green
                    };
                    return;
                }

                // Включение повтора трека
                else if (loop === RepeatType.Songs) {
                    queue.tracks.repeat = RepeatType.Song;
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.song"),
                        color: Colors.Green
                    };
                    return;
                }

                queue.tracks.repeat = RepeatType.None;
                msg.FBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.off"),
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
export default Object.values({ButtonRepeat});