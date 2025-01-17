import {AudioPlayer, AudioPlayerEvents, CollectionAudioEvents, Queue, Track} from "@lib/player";
import {TypedEmitter} from "tiny-typed-emitter";
import {Interact} from "@util/discord";
import {Constructor} from "@handler";
import {db} from "@service/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с modules
 * @class dbl_audio
 * @public
 */
export class dbl_audio {
    /**
     * @description Хранилище очередей
     * @readonly
     * @private
     */
    private readonly _queue = new AudioQueues();

    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @private
     */
    private readonly _cycles = new AudioCycles();

    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @private
     */
    private readonly _options = {
        volume: parseInt(env.get("audio.volume")),
        fade: parseInt(env.get("audio.fade")),
        optimization: parseInt(env.get("duration.optimization"))
    };

    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this._cycles; };

    /**
     * @description Выдаем данные для запуска AudioResource
     * @public
     */
    public get options() { return this._options; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this._queue; };
}

/**
 * @author SNIPPIK
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class AudioQueues
 * @private
 */
class AudioQueues extends Constructor.Collection<Queue> {
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

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @private
 */
class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление плеерами
     * @readonly
     * @private
     */
    private readonly _audioPlayers = new class extends Constructor.Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayer",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player): void => {
                    if (player.voice.connection?.state?.status !== "ready" || player?.status === "player/pause") return;
                    else {
                        const packet = player.audio.current.packet;

                        if (!packet) player.stop();
                        else player.voice.send = packet;
                    }
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Здесь происходит управление сообщениями и их обновлениями
     * @readonly
     * @private
     */
    private readonly _messages = new class extends Constructor.Cycle<Interact> {
        public constructor() {
            super({
                name: "Message",
                duration: 30e3,
                filter: (message) => !!message.editable,
                execute: (message) => {
                    const {guild} = message;
                    const queue = db.audio.queue.get(guild.id);

                    if (!queue || !queue.player) return this.remove(message);
                    else if (!queue.player.playing || !message.editable) return;

                    // Обновляем сообщение о текущем треке
                    db.audio.queue.events.emit("message/playing", queue, message);
                },
                custom: {
                    remove: (item) => { item.delete = 200; },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        // Удаляем прошлое сообщение
                        if (old) this.remove(old);
                    }
                },
            });
        };
    };

    /**
     * @description Выдаем базу циклов для работы плеера
     * @public
     */
    public get players() { return this._audioPlayers; };

    /**
     * @description Выдаем базу циклов сообщений для обновления сообщения
     * @public
     */
    public get messages() { return this._messages; };
}