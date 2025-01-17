import {Constructor, Handler} from "@handler";
import {db} from "@service/db";

/**
 * @author SNIPPIK
 * @description Завершение проигрывания трека
 * @class eventPlayer_ended
 * @event player/ended
 * @public
 */
class player_ended extends Constructor.Assign<Handler.Event<"player/ended">> {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            once: false,
            execute: (player,  seek) => {
                const queue = db.audio.queue.get(player.id);

                // Если это модификация трека, фильтры к примеру, то не даем отправить сообщение
                if (seek !== 0) return;
                db.audio.queue.events.emit("message/playing", queue);
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Плеер ожидает действий
 * @class eventPlayer_wait
 * @event player/wait
 * @public
 */
class player_wait extends Constructor.Assign<Handler.Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            once: false,
            execute: (player) => {
                const queue = db.audio.queue.get(player.id);
                const repeat = player.tracks.repeat;
                const position = player.tracks.position;

                // Если включен повтор трека сменить позицию нельзя
                if (repeat === "song") player.tracks.position = position;

                // Если включен повтор треков
                else if (repeat === "songs") {
                    // Переключаем позицию на первый трек
                    if (position >= player.tracks.total) player.tracks.position = 0;

                    // Переключаем с первой на последнею
                    else if (position < 0) player.tracks.position = player.tracks.total - 1;

                    // Меняем позицию трека в списке
                    player.tracks.position = player.tracks.position + 1;
                }

                // Если повтор выключен
                else {
                    // Если уже максимальная позиция
                    if (player.tracks.position + 1 === player.tracks.total) return queue.cleanup();

                    player.tracks.position = player.tracks.position + 1;
                }

                // Получаем ссылки на трек и проигрываем ее
                setTimeout(player.play, 2e3);
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
class player_error extends Constructor.Assign<Handler.Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            once: false,
            execute: (player, err, skip) => {
                const queue = db.audio.queue.get(player.id);

                // Заставляем плеер пропустить этот трек
                if (skip) {
                    if (player.tracks.size === 1) queue.cleanup();
                    else player.tracks.remove(skip.position);
                }

                // Выводим сообщение об ошибке
                db.audio.queue.events.emit("message/error", queue, err);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({player_ended, player_wait, player_error});