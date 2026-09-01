import type { Track } from "#core/queue/index.js";

export const REST_STOP_WORDS = new Set([
    "official",
    "video",
    "audio",
    "lyrics",
    "lyric",
    "mv",
    "hd",
    "hq",
    "feat",
    "ft",
    "remastered",
    "remaster",
    "version",
]);

/**
 * @author SNIPPIK
 * @description Названия всех доступных платформ
 * @type RestAPINames
 * @public
 */
export type RestAPINames =
    | "RADIO"
    | "YOUTUBE"
    | "SPOTIFY"
    | "SOUNDCLOUD"
    | "DEEZER"
    | "VK"
    | "YANDEX"
    | "APPLE_MUSIC";

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
export type APIRequestsKeys =
    | "all"
    | "track"
    | "search"
    | "artist"
    | "related"
    | "album"
    | "playlist";

/**
 * @author SNIPPIK
 * @description Типы запросов с лимитом кол-ва треков при запросе
 * @type APIRequestsLimits
 * @public
 */
export type APIRequestsLimits =
    | "playlist"
    | "album"
    | "search"
    | "artist"
    | "related";

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequests
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
 * @public
 */
export type APIRequestsRaw<T extends APIRequestsKeys, K = APIRequestData.Track> =
    T extends "track" ? APIRequestData.Track :
        T extends "playlist" | "album" | "related" ? APIRequestData.List<K> :
            T extends "artist" | "search" ? APIRequestData.Track[] :
                T extends "all" ? APIRequestData.Track | APIRequestData.Track[] | APIRequestData.List<K> :
                    never;

/**
 * @author SNIPPIK
 * @description Тип параметров функции вызова для каждого запроса
 * @type APIExecuteParams
 * @public
 */
export type APIExecuteParams<T extends APIRequestsKeys> =
    T extends "track" ? { audio: boolean } :
        T extends APIRequestsLimits ? { limit: number } :
            T extends "all" ? { audio: boolean, limit: number } :
        never;

/**
 * @author SNIPPIK
 * @description
 * @namespace RestWorkerResult
 * @public
 */
export namespace RestWorkerResult {
    /**
     * @description Передаваемые данные из worker в основной поток
     * @type Result
     * @public
     */
    export type Result<T extends APIRequestsKeys> = {
        // Номер уникального запроса
        requestId: number;
    } & (Success<T> | Error);

    /**
     * @description Если запрос обработан без ошибок
     * @type Success
     * @private
     */
    interface Success<
        T extends APIRequestsKeys
    > {
        status: "success";
        requestId: number;
        type: T;
        result: APIRequestsRaw<T>;
    }

    /**
     * @description Если запрос обработан без ошибок
     * @type Error
     * @private
     */
    interface Error {
        status: "error";
        requestId: number;
        result: {
            name: string;
            message?: string;
            stack?: string;
        };
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
        readonly id?: string;

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
        readonly image: string;

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
        readonly image: string;

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
        readonly title: string;

        /**
         * @description Ссылка на автора трека
         * @readonly
         */
        readonly url: string;

        /**
         * @description Картинка артиста трека
         */
        readonly image?: string;
    }
}