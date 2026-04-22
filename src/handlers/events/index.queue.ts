import { CycleInteraction } from "#structures/discord";
import { Queue } from "#core/queue/structures/queue";
import { Track } from "#core/queue/structures/track";
import { APIRequestData } from "#handler/rest";

/**
 * @author SNIPPIK
 * @description События глобальной системы очередей
 * @interface QueueEvents
 * @public
 */
export interface QueueEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param queue      - Очередь сервера
     * @param user       - Пользователь включивший трек
     * @param items      - Трек или плейлист, альбом
     * @returns void
     * @readonly
     */
    readonly "message/push": (msg: CycleInteraction, queue: Queue, items: Track | APIRequestData.List<Track>) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "message/playing": (queue: Queue) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка
     * @returns void
     * @readonly
     */
    readonly "message/error": (queue: Queue, error?: string | Error, position?: number) => void;

    /**
     * @description Событие при котором очередь очищается и становится в режим ожидания, простым языком "player-end-playing"
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/cleanup": (queue: Queue) => void;

    /**
     * @description Событие при котором очередь полностью удаляется со всеми компонентами
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/destroy": (queue: Queue) => void;
}