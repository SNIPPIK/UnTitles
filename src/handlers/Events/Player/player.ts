import {Constructor, Handler} from "@handler";
import {db} from "@lib/db";

/**
 * @class onEnd
 * @event player/ended
 * @description Завершение проигрывания трека
 */
class onEnd extends Constructor.Assign<Handler.Event<"player/ended">> {
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
 * @class onWait
 * @event player/wait
 * @description Плеер ожидает действий
 */
class onWait extends Constructor.Assign<Handler.Event<"player/wait">> {
    public constructor() {
        super({
            name: "player/wait",
            type: "player",
            execute: (player) => {
                const queue = db.audio.queue.get(player.ID);

                //Если нет треков в очереди
                if (!queue?.songs?.song || !queue.player) return db.audio.queue.remove(queue.guild.id);

                //Проверяем надо ли удалить из очереди трек
                const removedSong = queue.repeat === "off" || queue.repeat === "songs" ? queue.songs.shift() : null;
                if (removedSong && queue.repeat === "songs") queue.songs.push(removedSong);

                //Проверяем надо ли перетасовывать очередь
                if (queue.shuffle && queue.repeat === "off") {
                    for (let i = queue.songs.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [queue.songs[i], queue.songs[j]] = [queue.songs[j], queue.songs[i]];
                    }
                }

                //Включаем трек через время
                setTimeout(() => queue.player.play(queue.songs.song), db.audio.options.timeout);
            }
        });
    }
}

/**
 * @class onError
 * @event player/error
 * @description Плеер словил ошибку
 */
class onError extends Constructor.Assign<Handler.Event<"player/error">> {
    public constructor() {
        super({
            name: "player/error",
            type: "player",
            execute: (player, err, crash) => {
                const queue = db.audio.queue.get(player.ID);

                //Если нет плеера, то нет смысла продолжать
                if (!queue || !queue.player || !queue.player.play) return;

                setImmediate(() => {
                    switch (crash) {
                        //Если надо пропустить трек из-за ошибки
                        case "skip": {
                            //Если есть треки в очереди
                            if (queue.songs.size > 0) {
                                setImmediate(() => {
                                    queue.songs.shift();

                                    //Включаем трек через время
                                    setTimeout(() => queue.player.play(queue.songs.song), db.audio.options.timeout);
                                });
                            }
                            return;
                        }

                        //Если возникает критическая ошибка
                        case "crash": {
                            db.audio.queue.remove(queue.guild.id);
                            return;
                        }
                    }
                });

                //Выводим сообщение об ошибке
                return db.audio.queue.events.emit("message/error", queue, err);
            }
        });
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({onError, onWait, onEnd});