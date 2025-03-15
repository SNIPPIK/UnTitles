import {RepeatType} from "@service/player";
import {Event} from "@handler/events";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Плеер ожидает действий
 * @class eventPlayer_wait
 * @event player/wait
 * @public
 */
class player_wait extends Assign<Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            once: false,
            execute: (player) => {
                const queue = db.queues.get(player.id);
                const repeat = player.tracks.repeat;
                const current = player.tracks.position;

                // Если включен повтор трека сменить позицию нельзя
                if (repeat === RepeatType.Song) player.tracks.position = current;

                // Если включен повтор треков или его вовсе нет
                else {
                    // Меняем позицию трека в списке
                    player.tracks.position = player.tracks.position + 1;

                    // Если повтор выключен
                    if (repeat === RepeatType.None) {
                        // Если очередь началась заново
                        if (current + 1 === player.tracks.total && player.tracks.position === 0) return queue.cleanup();
                    }
                }

                // Через время запускаем трек, что-бы не нарушать работу VoiceSocket
                // Что будет если нарушить работу VoiceSocket, пинг >=1000
                setTimeout(player.play, 2500);
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Плеер поймал ошибку
 * @class eventPlayer_error
 * @event player/error
 * @public
 */
class player_error extends Assign<Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            once: false,
            execute: (player, err, skip) => {
                const queue = db.queues.get(player.id);

                // Заставляем плеер пропустить этот трек
                if (skip) {
                    if (player.tracks.size === 1) queue.cleanup();
                    else player.tracks.remove(skip.position);
                }

                // Выводим сообщение об ошибке
                db.events.emitter.emit("message/error", queue, err);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({player_wait, player_error});