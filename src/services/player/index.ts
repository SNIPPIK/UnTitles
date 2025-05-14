import {AudioPlayer, Queue, Track} from "@service/player";
import {RestClientSide} from "@handler/rest/apis";
import {CommandInteraction} from "@structures";

export * from "./structures/track";
export * from "./structures/queue";
export * from "./structures/player";
export * from "./modules/filters";
export * from "./modules/tracks";

/**
 * @author SNIPPIK
 * @description События плеера
 * @interface AudioPlayerEvents
 * @public
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
 * @public
 */
export interface QueuesEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param message - Сообщение с сервера
     * @param items   - Трек или плейлист, альбом
     */
    readonly "message/push": (message: CommandInteraction, items: Track | Track.list) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     */
    readonly "message/playing": (queue: Queue) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка в формате string или в типе Error
     */
    readonly "message/error": (queue: Queue, error?: string | Error, position?: number) => void;

    /**
     * @description Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     */
    readonly "rest/request": (api: RestClientSide.Request, message: CommandInteraction, url: string | json) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    readonly "rest/error": (message: CommandInteraction, error: string) => void;
}