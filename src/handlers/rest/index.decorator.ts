import { RestAPINames, APIPlatformType } from "#handler/rest/index.abstract.js";
import type { CommandInteraction } from "#structures/discord/index.js";
import type { RestClientSide } from "#handler/rest/index.js";
import { env } from "#db/env";

/**
 * @author SNIPPIK
 * @description Параметры запроса
 * @interface RestOptions
 * @private
 */
export interface RestOptions {
    /**
     * @description Название платформы
     * @readonly
     */
    readonly name: RestAPINames;

    /**
     * @description Ссылка на платформу
     * @readonly
     */
    readonly url?: string;

    /**
     * @description Цвет платформы, в стиле discord
     * @readonly
     */
    readonly color: number;

    /**
     * @description Может ли платформа получать аудио сама. Аудио получается через запрос к track
     * @readonly
     */
    readonly audio: boolean;

    /**
     * @description Если ли данные для авторизации
     * @default undefined - данные не требуются
     * @readonly
     */
    readonly auth?: boolean;

    /**
     * @description Может ли платформа запрашивать повторное получение аудио
     * @default false - разово
     * @readonly
     */
    readonly retry?: boolean;

    /**
     * @description Тип платформы, платформа может быть технической или же прямой
     * @default APIPlatformType
     * @readonly
     */
    readonly type?: APIPlatformType;

    /**
     * @description Regexp для поиска платформы
     * @readonly
     */
    readonly filter?: RegExp;
}

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок запроса
 * @decorator
 * @public
 */
export function DeclareRest(options: RestOptions) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
            url = options.url;
            color = options.color;
            audio = options.audio;
            filter = options.filter;
            type = options.type ?? APIPlatformType.primary;

            // Авторизируемся если это надо во 2 потоке
            auth =
                options.type === APIPlatformType.technical ? true :
                    options.auth ? env.get(`${options.name.toLowerCase()}.token`, null) :
                        undefined;

            proxy = env.get(`${options.name.toLowerCase()}.proxy`, false);
            retry = options.retry ?? false;
        }
}

/**
 * @author SNIPPIK
 * @description Дополнительные параметры
 * @decorator
 * @public
 */
export function OptionsRest<T>(options: T) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            options = options;
        }
}

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