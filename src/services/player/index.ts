import {AudioPlayer, Queue, Track} from "@service/player";
import {Cycle, Interact, MessageUtils} from "@utils";
import {Attachment} from "discord.js";
import {db} from "@app";

export * from "./structures/track";
export * from "./structures/queue";
export * from "./structures/player";
export * from "./modules/filters";
export * from "./modules/tracks";

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @public
 */
export class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
     * @readonly
     * @public
     */
    public readonly players = new class AudioPlayers extends Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayers",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player) => {
                    // Отправляем пакет
                    player.voice.send = player.audio.current.packet;
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @readonly
     * @public
     */
    public readonly messages = new class Messages extends Cycle<Interact> {
        public constructor() {
            super({
                name: "Messages",
                duration: 20e3,
                custom: {
                    remove: (item) => { MessageUtils.deleteMessage(item, 200) },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        // Удаляем прошлое сообщение
                        if (old) this.remove(old);
                    }
                },
                filter: (message) => message.editable,
                execute: (message) => {
                    const queue = message.queue;

                    // Если есть поток в плеере
                    if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                        // Обновляем сообщение о текущем треке
                        db.events.emitter.emit("message/playing", queue, message);
                        return;
                    }
                }
            });
        };
    };
}

/**
 * @author SNIPPIK
 * @description События плеера
 * @interface AudioPlayerEvents
 */
export interface AudioPlayerEvents {
    /**
     * @description Событие при котором плеер начинает завершение текущего трека
     * @param player - Текущий плеер
     * @param seek   - Время пропуска если оно есть
     */
    readonly "player/ended": (player: AudioPlayer, seek: number) => void;

    /**
     * @description Событие при котором плеер ожидает новый трек
     * @param player - Текущий плеер
     */
    readonly "player/wait": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер встает на паузу и ожидает дальнейших действий
     * @param player - Текущий плеер
     */
    readonly "player/pause": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер начинает проигрывание
     * @param player - Текущий плеер
     */
    readonly "player/playing": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер получает ошибку
     * @param player - Текущий плеер
     * @param err    - Ошибка в формате string
     * @param skip   - Если надо пропустить трек
     * @param position - Позиция трека в очереди
     */
    readonly "player/error": (player: AudioPlayer, err: string, track?: {skip: boolean, position: number}) => void;
}

/**
 * @author SNIPPIK
 * @description События глобальной системы очередей
 * @interface QueuesEvents
 */
export interface QueuesEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param message - Сообщение с сервера
     * @param items   - Трек или плейлист, альбом
     */
    readonly "message/push": (message: Interact, items: Track | Track.playlist) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @param message   - Сообщение с сервера
     */
    readonly "message/playing": (queue: Queue, message?: Interact) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка в формате string или в типе Error
     */
    readonly "message/error": (queue: Queue, error?: string | Error) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об найденных треках
     * @param tracks     - Найденные треки
     * @param platform   - Имя платформы
     * @param message    - Сообщение с сервера
     */
    readonly "message/search": (tracks: Track[], platform: string, message: Interact) => void;

    /**
     * @description Событие при котором коллекция будет искать трек в системе API
     * @param message    - Сообщение с сервера
     * @param argument   - Что надо будет найти, первый аргумент должен быть имя платформы
     */
    readonly "request/api": (message: Interact, argument: (string | Attachment)[]) => void;

    /**
     * @description Событие при котором коллекция будет отправлять ошибки в системе API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    readonly "request/error": (message: Interact, error: string) => void;
}