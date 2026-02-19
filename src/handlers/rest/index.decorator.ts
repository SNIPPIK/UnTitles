import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import type { Track } from "#core/queue";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Прокси агент, доступен только во 2 потоке
 * @private
 */
export const RestAPIAgent = createProxyAgent();

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
     * @description Тип платформы, платформа может быть технической или же прямой
     * @default APIPlatformType.primary
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
 * @description Создание прокси агента для запросов
 * @private
 */
function createProxyAgent() {
    const url = env.get("APIs.proxy", "");

    if (typeof url !== "string" || url.length === 0) return null;
    if (url.startsWith("socks")) return new SocksProxyAgent(url);
    if (url.startsWith("http")) return new HttpProxyAgent(url);

    return null;
}

/**
 * @author SNIPPIK
 * @description Тип параметров функции вызова для каждого запроса
 * @type APIExecuteParams
 * @helper
 */
export type APIExecuteParams<T extends APIRequestsKeys> =
    T extends "track" ? { audio: boolean } : T extends APIRequestsLimits ? { limit: number } : T extends "all" ? { audio: boolean, limit: number } :
        never;

/**
 * @author SNIPPIK
 * @description Названия всех доступных платформ
 * @type RestAPINames
 * @public
 */
export type RestAPINames = "RADIO" | "YOUTUBE" | "SPOTIFY" | "VK" | "YANDEX" | "SOUNDCLOUD" | "DEEZER" | "APPLE_MUSIC";

/**
 * @author SNIPPIK
 * @description Все типы запросов
 * @type APIRequestsKeys
 * @public
 *
 * @param all - Включает в себя все запросы, полезно если платформа не умеет разделять типы данных
 * @param track - Данных о треке
 * @param playlist - Данных о плейлисте
 * @param album - Данные об альбоме
 * @param search - Данные о найденных треках
 * @param artist - Популярные треки автора
 * @param related - Похожие треки
 */
export type APIRequestsKeys = "all" | "track" | "playlist" | "album" | "search" | "artist" | "related";

/**
 * @author SNIPPIK
 * @description Типы запросов с лимитом кол-ва треков при запросе
 * @type APIRequestsLimits
 * @public
 */
export type APIRequestsLimits = "playlist" | "album" | "search" | "artist" | "related";

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequests
 * @helper
 * @public
 */
export type APIRequests<T extends APIRequestsKeys, K = Track> =
    T extends "track" ? Track :
        T extends "playlist" | "album" | "related" ? APIRequestData.List<K> :
            T extends "artist" | "search" ? Track[] :
            T extends "all" ? Track | Track[] | APIRequestData.List<K> :
            never;

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequestsRaw
 * @helper
 * @public
 */
export type APIRequestsRaw<T extends APIRequestsKeys, K = APIRequestData.Track> =
    T extends "track" ? APIRequestData.Track :
        T extends "playlist" | "album" | "related" ? APIRequestData.List<K> :
        T extends "artist" | "search" ? APIRequestData.Track[] :
            T extends "all" ? APIRequestData.Track | APIRequestData.Track[] | APIRequestData.List<K> :
            never;


/**
 * @description Сырые типы данных для дальнейшего использования
 * @namespace APIRequestData
 * @helper
 * @public
 */
export namespace APIRequestData {
    /**
     * @description Сырые данные объекта трека
     * @interface Track
     * @public
     */
    export interface Track {
        /**
         * @description Уникальный id трека
         * @readonly
         */
        readonly id?: string

        /**
         * @description Название трека
         * @readonly
         */
        title: string;

        /**
         * @description Ссылка на трек, именно на трек
         * @readonly
         */
        readonly url: string;

        /**
         * @description Данные об авторе трека
         */
        artist: Artist;

        /**
         * @description База с картинками трека и автора
         */
        image: string;

        /**
         * @description Данные о времени трека
         */
        time: {
            /**
             * @description Общее время трека
             */
            total: string;

            /**
             * @description Время конвертированное в 00:00
             */
            split?: string;
        }

        /**
         * @description Данные об исходном файле, он же сам трек
         */
        audio?: string;
    }

    /**
     * @description Сырые данные объекта списка
     * @interface List
     * @public
     */
    export interface List<K = Track> {
        /**
         * @description Уникальный id листа
         * @readonly
         */
        readonly id?: string;

        /**
         * @description Ссылка на плейлист
         * @readonly
         */
        readonly url: string;

        /**
         * @description Название плейлиста
         * @readonly
         */
        readonly title: string;

        /**
         * @description Что в себе содержит плейлист
         */
        items: K[];

        /**
         * @description Картинка автора плейлиста
         */
        image: string;

        /**
         * @description Данные об авторе плейлиста
         */
        artist?: Artist;
    }

    /**
     * @description Данные об авторе трека или плейлиста
     * @interface Artist
     */
    export interface Artist {
        /**
         * @description Ник/имя автора трека
         * @readonly
         */
        title: string;

        /**
         * @description Ссылка на автора трека
         * @readonly
         */
        readonly url: string;

        /**
         * @description Картинка артиста трека
         */
        image?: string;
    }
}


/**
 * @author SNIPPIK
 * @description Ключи для типизации типов платформ
 * @enum APIPlatformType
 * @public
 */
export enum APIPlatformType {
    /**
     * @description Данный тип только для взаимодействия с техническими платформами. Не доступен для публичного использования!
     * @private
     */
    technical = "technical",

    /**
     * @description Данный тип только для взаимодействия с публичными платформами
     * @public
     */
    primary = "primary"
}