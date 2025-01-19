import {Interact} from "@util/discord";
import {Attachment} from "discord.js";
import {Track} from "./Queue/track";
import {Queue} from "./Queue/queue";

/**
 * @author SNIPPIK
 * @description События коллекции
 * @interface CollectionAudioEvents
 */
export interface CollectionAudioEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param message - Сообщение с сервера
     * @param items   - Трек или плейлист, альбом
     */
    "message/push": (message: Interact, items: Track | Track.playlist) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @param message   - Сообщение с сервера
     */
    "message/playing": (queue: Queue, message?: Interact) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка в формате string или в типе Error
     */
    "message/error": (queue: Queue, error?: string | Error) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об найденных треках
     * @param tracks     - Найденные треки
     * @param platform   - Имя платформы
     * @param message    - Сообщение с сервера
     */
    "message/search": (tracks: Track[], platform: string, message: Interact) => void;

    /**
     * @description Событие при котором коллекция будет искать трек в системе API
     * @param message    - Сообщение с сервера
     * @param argument   - Что надо будет найти, первый аргумент должен быть имя платформы
     */
    "request/api": (message: Interact, argument: (string | Attachment)[]) => void;

    /**
     * @description Событие при котором коллекция будет отправлять ошибки в системе API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    "request/error": (message: Interact, error: string) => void;
}

export {AudioPlayerEvents, AudioPlayer} from "./AudioPlayer";
export {AudioFilter} from "./AudioPlayer/PlayerAudioFilters";

export {Queue} from "./Queue/queue";
export {Track} from "./Queue/track";