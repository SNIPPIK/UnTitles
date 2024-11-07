import {ExtraPlayer, AudioPlayerEvents} from "@lib/player";
import {Interact} from "@lib/discord/utils/Interact";
import {TypedEmitter} from "tiny-typed-emitter";
import {Queue, Track} from "@lib/player/queue";
import {Attachment} from "discord.js";
import {Constructor} from "@handler";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с modules
 * @abstract
 */
export class Database_Audio {
    private readonly data = {
        queue: new AudioQueues(),
        cycles: new Cycles(),

        options: {
            volume: parseInt(env.get("audio.volume")),
            fade: parseInt(env.get("audio.fade"))
        }
    };
    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this.data.cycles; };

    /**
     * @description Выдаем данные для запуска AudioResource
     * @public
     */
    public get options() { return this.data.options; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this.data.queue; };
}

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class Cycles
 * @private
 */
class Cycles {
    /**
     * @author SNIPPIK
     * @description Здесь происходит управление плеерами
     * @private
     */
    private readonly _audioPlayers = new class extends Constructor.Cycle<ExtraPlayer> {
        public constructor() {
            super({
                name: "AudioPlayer",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player) => {
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
     * @description Здесь происходит управление сообщениями от плеера
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
                    remove: (item) => {
                        item.delete = 200;
                    },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        //Если это-же сообщение есть в базе, то нечего не делаем
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

/**
 * @author SNIPPIK
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class AudioQueues
 * @private
 */
class AudioQueues extends Constructor.Collection<Queue> {
    /**
     * @description Ивенты привязанные к плееру и очереди
     * @private
     */
    private readonly emitter = new class extends TypedEmitter<CollectionAudioEvents & AudioPlayerEvents> {
        private _playerEvents: (keyof AudioPlayerEvents)[] = null;

        /**
         * @description Ивенты плеера
         * @return (keyof AudioPlayerEvents)[]
         */
        public get player() {
            if (this._playerEvents) return this._playerEvents;

            this._playerEvents = this.eventNames().filter((item: keyof AudioPlayerEvents) => item.match(/player\//)) as (keyof AudioPlayerEvents)[];
            return this._playerEvents;
        };
    }

    /**
     * @description Получаем ивенты для плеера
     * @return CollectionAudioEvents
     * @public
     */
    public get events() { return this.emitter; };

    /**
     * @description Проверяем надо ли создать очередь и добавляем треки в нее
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     */
    public create = (message: Interact, item: any) => {
        let queue = db.audio.queue.get(message.guild.id);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message);

        // Отправляем сообщение о том что было добавлено
        else if ((item instanceof Track && queue.songs.size >= 1) || "items" in item) {
            db.audio.queue.events.emit("message/push", message, item);
        }

        // Добавляем треки в очередь
        for (const track of (item["items"] ?? [item]) as Track[]) {
            track.user = message.author;
            queue.songs.push(track);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Ивенты коллекции
 * @interface CollectionAudioEvents
 */
export interface CollectionAudioEvents {
    // Сообщение о добавленном треке или плейлисте, альбоме
    "message/push": (message: Interact, items: Track | Track.playlist) => void;

    // Сообщение о текущем треке
    "message/playing": (queue: Queue, message?: Interact) => void;

    // Сообщение об ошибке
    "message/error": (queue: Queue, error?: string | Error) => void;

    // Сообщение о поиске и выборе трека
    "message/search": (tracks: Track[], platform: string, message: Interact) => void;

    // Сообщение о последнем треке
    "message/last": (track: Track, message: Interact) => void;

    // Добавляем и создаем очередь
    "request/api": (message: Interact, argument: (string | Attachment)[]) => void;

    // Если во время добавления трека или плейлиста произошла ошибка
    "request/error": (message: Interact, error: string, replied?: boolean, color?: "DarkRed" | "Yellow") => void;

    // Включен трека при условии, что уже включен трек
    "request/time": (queue: Queue, position: number) => void;
}