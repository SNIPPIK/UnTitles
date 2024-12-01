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
            execute: (player,  seek) => {
                const queue = db.audio.queue.get(player.id);

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
            execute: (player) => {
                const queue = db.audio.queue.get(player.id);

                // Если нет треков в очереди
                if (!queue?.tracks?.track || !queue.player) return db.audio.queue.remove(player.id);

                // Проверяем надо ли удалить из очереди трек
                if (queue.repeat === "off" || queue.repeat === "songs") {
                    // Смена трек на следующий
                    queue.tracks.swapPosition = queue.tracks.position + 1;

                    // Если включен повтор и нет больше треков, значит включаем обратно все треки
                    if (queue.repeat === "songs" && queue.tracks.position >= queue.tracks.total) queue.tracks.swapPosition = 0;
                }

                // Проверяем надо ли перетасовывать очередь
                if (queue.shuffle && queue.repeat === "off") queue.tracks.shuffle();

                // Получаем ссылки на трек и проигрываем ее
                setTimeout(() => queue.player.play(), 2e3);
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
            execute: (player, err, crash) => {
                const queue = db.audio.queue.get(player.id);

                // Если нет плеера, то нет смысла продолжать
                if (!queue || !queue.player) return;

                // Если возникла критическая ошибка
                if (crash) db.audio.queue.remove(queue.guild.id);
                else {
                    // Заставляем плеер пропустить этот трек
                    if (queue.tracks.size > 0) player.status = "player/ended";
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