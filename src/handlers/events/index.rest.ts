import { CommandInteraction } from "#structures/discord";
import { RestClientSide } from "#handler/rest";

/**
 * @author SNIPPIK
 * @description События глобальной системы очередей
 * @interface QueueEvents
 * @public
 */
export interface RestAPIEvents {
    /**
     * @description Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     * @returns void
     * @readonly
     */
    readonly "rest/request": (api: RestClientSide.Request, message: CommandInteraction, url: string) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка
     * @returns void
     * @readonly
     */
    readonly "rest/error": (message: CommandInteraction, error: string | Error) => void;
}