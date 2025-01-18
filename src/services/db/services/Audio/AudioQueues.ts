import {AudioPlayerEvents, CollectionAudioEvents, Queue, Track} from "@lib/player";
import {TypedEmitter} from "tiny-typed-emitter";
import {Interact} from "@util/discord";
import {Constructor} from "@handler";
import {db} from "@service/db";

/**
 * @author SNIPPIK
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class AudioQueues
 * @private
 */
export class AudioQueues extends Constructor.Collection<Queue> {
    /**
     * @description События привязанные к плееру и очереди
     * @readonly
     * @private
     */
    private readonly emitter = new class extends TypedEmitter<CollectionAudioEvents & AudioPlayerEvents> {
        /**
         * @description Имена событий плеера, с авто поиском
         * @private
         */
        private _playerEvents: (keyof AudioPlayerEvents)[] = null;

        /**
         * @description События плеера
         * @return (keyof AudioPlayerEvents)[]
         */
        public get player() {
            if (this._playerEvents) return this._playerEvents;

            this._playerEvents = this.eventNames().filter((item) => item.match(/player\//)) as (keyof AudioPlayerEvents)[];
            return this._playerEvents;
        };
    }

    /**
     * @description Получаем события для плеера
     * @return CollectionAudioEvents
     * @public
     */
    public get events() { return this.emitter; };

    /**
     * @description Проверяем надо ли создать очередь и добавляем треки в нее
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     */
    public create = (message: Interact, item: Track.playlist | Track) => {
        let queue = db.audio.queue.get(message.guild.id);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message);
        else {
            // Значит что плеера нет в циклах
            if (!db.audio.cycles.players.match(queue.player)) {
                // Если это новый текстовый канал
                if (queue.message.channel.id !== message.channel.id) queue.message = message;

                // Добавляем плеер в базу цикла для отправки пакетов
                db.audio.cycles.players.set(queue.player);

                // Запускаем проигрывание заново
                setImmediate(queue.player.play);
            }
        }

        // Отправляем сообщение о том что было добавлено
        if ("items" in item || item instanceof Track && queue.tracks.total > 0) {
            db.audio.queue.events.emit("message/push", message, item);
        }

        // Добавляем треки в очередь
        for (const track of (item["items"] ?? [item]) as Track[]) {
            track.user = message.author;
            queue.tracks.push(track);
        }
    };
}