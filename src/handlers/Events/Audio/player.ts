import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";

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
                // Если нет треков в очереди
                if (!player?.tracks?.track || !player) return db.audio.queue.remove(player.id);

                // Авто переключение трека
                player.tracks.autoPosition();

                // Получаем ссылки на трек и проигрываем ее
                setTimeout(() => player.play(), 2e3);
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
            execute: (player, err, crash) => {
                const queue = db.audio.queue.get(player.id);

                // Если нет плеера, то нет смысла продолжать
                if (!queue || !player) return;

                // Если возникла критическая ошибка
                if (crash) db.audio.queue.remove(player.id);
                else {
                    // Заставляем плеер пропустить этот трек
                    if (player.tracks.size > 0) player.status = "player/ended";
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