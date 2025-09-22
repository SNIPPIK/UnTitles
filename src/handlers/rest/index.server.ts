import type { APIRequests, APIRequestsRaw } from "./index";
import type { RestAPIS_Names } from "./index.decorator";
import type { RestClientSide } from "./index.client";

/**
 * @description Тип параметров для каждого запроса
 * @type ExecuteParams
 * @helper
 */
type ExecuteParams<T extends keyof APIRequests = keyof APIRequests> = T extends "track" ? { audio: boolean } : T extends "playlist" | "album" | "artist" | "related" | "search" ? { limit: number } : never;

/**
 * @author SNIPPIK
 * @description Данные для работы серверной части (Worker)
 * @namespace RestServerSide
 * @public
 */
export namespace RestServerSide {
    /**
     * @description Пример класса с типами
     * @type APIs
     */
    export type APIs = Record<API['name'], API>

    /**
     * @description Данные для валидного запроса параллельном процессу
     * @interface ServerOptions
     */
    export type ServerOptions = RestClientSide.ClientOptions & {
        platform: RestAPIS_Names;
        data?: boolean
    }

    /**
     * @description Передаваемые данные из worker в основной поток
     * @type Result
     * @public
     */
    export type Result<T extends keyof APIRequests = keyof APIRequests> = {
        requestId: number;
        status: "success";
        type: T;
        result: APIRequestsRaw[T];
    } | {
        requestId: number;
        status: "error";
        result: Error;
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface APIBase
     * @public
     */
    export interface APIBase {
        /**
         * @description Название платформы
         */
        readonly name: RestAPIS_Names;

        /**
         * @description Ссылка на платформу
         */
        readonly url: string;

        /**
         * @description Цвет платформы, в стиле discord
         */
        readonly color: number;
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @class API
     * @public
     */
    export class API implements APIBase {
        /**
         * @description Название платформы
         */
        readonly name: RestAPIS_Names;

        /**
         * @description Ссылка на платформу
         */
        readonly url: string;

        /**
         * @description Цвет платформы, в стиле discord
         */
        readonly color: number;

        /**
         * @description Может ли платформа получать аудио сама. Аудио получается через запрос к track
         */
        readonly audio: boolean;

        /**
         * @description Если ли данные для авторизации
         * @default undefined - данные не требуются
         */
        readonly auth?: string;

        /**
         * @description Regexp для поиска платформы
         */
        readonly filter: RegExp;

        /**
         * @description Запросы к данных платформы
         */
        readonly requests: (RequestDef<"track"> | RequestDef<"search"> | RequestDef<"artist"> | RequestDef<"related"> | RequestDef<"album"> | RequestDef<"playlist">)[];

        /**
         * @description Доп параметры
         */
        readonly options: any;
    }

    /**
     * @description Доступные запросы для платформ
     * @interface RequestDef
     * @public
     */
    export interface RequestDef<T extends keyof APIRequests = keyof APIRequests> {
        name: T
        filter?: RegExp
        execute: (url: string, options: ExecuteParams<T>) => Promise<APIRequestsRaw[T] | Error>;
    }

    /**
     * @description Данные класса для работы с Rest/API
     * @interface Data
     * @public
     */
    export interface Data {
        /**
         * @description Все загруженные платформы
         * @protected
         */
        supported: APIs;

        /**
         * @description Платформы с данных для авторизации
         * @protected
         */
        authorization: RestAPIS_Names[];

        /**
         * @description Платформы с возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: RestAPIS_Names[];

        /**
         * @description Платформы с возможностью получать похожие треки
         * @protected
         */
        related: RestAPIS_Names[];

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: RestAPIS_Names[];
    }
}