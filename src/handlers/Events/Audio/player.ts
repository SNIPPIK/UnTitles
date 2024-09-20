import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";

/**
 * @class eventPlayer_ended
 * @event player/ended
 * @description Завершение проигрывания трека
 */
class eventPlayer_ended extends Constructor.Assign<Handler.Event<"player/ended">> {
    public constructor() {
        super({
            name: "player/ended",
            type: "player",
            execute: (player,  seek) => {
                const queue = db.audio.queue.get(player.ID);

                if (seek !== 0) return;
                db.audio.queue.events.emit("message/playing", queue);
            }
        });
    };
}

/**
 * @class eventPlayer_wait
 * @event player/wait
 * @description Плеер ожидает действий
 */
class eventPlayer_wait extends Constructor.Assign<Handler.Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (player) => {
                const queue = db.audio.queue.get(player.ID);

                // Если нет треков в очереди
                if (!queue?.songs?.song || !queue.player) return db.audio.queue.remove(queue.guild.id);

                // Проверяем надо ли удалить из очереди трек
                if (queue.repeat === "off" || queue.repeat === "songs") {
                    // Смена трек на следующий
                    queue.songs.swapPosition = queue.songs.position + 1;
                }

                //Проверяем надо ли перетасовывать очередь
                if (queue.shuffle && queue.repeat === "off") queue.songs.shuffle();

                //Включаем трек через время
                queue.player.play(queue.songs.song);
            }
        });
    };
}

/**
 * @class eventPlayer_error
 * @event player/error
 * @description Плеер словил ошибку
 */
class eventPlayer_error extends Constructor.Assign<Handler.Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (player, err, crash) => {
                const queue = db.audio.queue.get(player.ID);

                //Если нет плеера, то нет смысла продолжать
                if (!queue || !queue.player) return;

                // Если возникла критическая ошибка
                if (crash) db.audio.queue.remove(queue.guild.id);
                else {
                    // Заставляем плеер пропустить этот трек
                    if (queue.songs.size > 0) player.status = "player/ended";
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
export default Object.values({eventPlayer_error, eventPlayer_wait, eventPlayer_ended});