import {Queue, Track} from "@service/player";
import {Interact, Collection} from "@utils";
import {AudioCycles} from "./audio/cycles";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class Queues
 */
export class Queues extends Collection<Queue> {
    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @public
     */
    public readonly cycles = new AudioCycles();

    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @public
     */
    public readonly options = {
        optimization: parseInt(env.get("duration.optimization")),
        volume: parseInt(env.get("audio.volume")),
        fade: parseInt(env.get("audio.fade"))
    };

    /**
     * @description Проверяем надо ли создать очередь и добавляем треки в нее
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     * @public
     */
    public create = (message: Interact, item?: Track.playlist | Track) => {
        let queue = this.get(message.guild.id);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message);
        else {
            // Значит что плеера нет в циклах
            if (!this.cycles.players.match(queue.player)) this._reconstructQueue(queue, message);
        }

        // Если надо перезапустить очередь
        if (item) {
            // Отправляем сообщение о том что было добавлено
            if ("items" in item || item instanceof Track && queue.tracks.total > 0) {
                db.events.emitter.emit("message/push", message, item);
            }

            // Добавляем треки в очередь
            for (const track of (item["items"] ?? [item]) as Track[]) {
                track.user = message.author;
                queue.tracks.push(track);
            }
        }
    };

    /**
     * @description Что надо делать когда очередь, но нет проигрывания плеера
     * @param queue   - Очередь сервера
     * @param message - Сообщение пользователя
     * @private
     */
    private _reconstructQueue = (queue: Queue, message: Interact) => {
        const voice = db.voice.get(message.guild.id);

        // Если нет голосового подключения
        if (!voice) queue.voice = message.voice;

        // Если это новый текстовый канал
        if (queue.message.channel.id !== message.channel.id) queue.message = message;

        // Добавляем плеер в базу цикла для отправки пакетов
        this.cycles.players.set(queue.player);

        // Если плеер не запустится сам
        setImmediate(() => {
            // Меняем позиции на самую последнюю
            queue.player.tracks.position = queue.player.tracks.total - 1;

            // Запускаем проигрывание
            setTimeout(queue.player.play, 1e3);
        });
    };
}

export * from "./utils/cache";
export * from "./utils/voice";
export * from "./utils/buttons";