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
     * @public
     */
    export type APIs = Record<RestAPIS_Names, API>;

    /**
     * @description Данные для валидного запроса параллельном процессу
     * @type ServerOptions
     * @public
     */
    export type ServerOptions = RestClientSide.ClientOptions & {
        // Название платформы
        platform: RestAPIS_Names;

        // Надо ли получить данные в ответ
        data?: boolean
    };

    /**
     * @description Рекурсивно проходит по всему объекту, оставляя только сериализуемые
     * @type Serializable
     * @public
     */
    export type Serializable<T> = T extends Function ? never : T extends object ? { [K in keyof T]: Serializable<T[K]> } : T;

    /**
     * @description Передаваемые данные из worker в основной поток
     * @type Result
     * @public
     */
    export type Result<T extends keyof APIRequests = keyof APIRequests> = {
        // Номер уникального запроса
        requestId: number;
    } & (ResultSuccess<T> | ResultError);

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface APIBase
     * @public
     */
    export interface APIBase {
        /**
         * @description Название платформы
         * @readonly
         */
        readonly name: RestAPIS_Names;

        /**
         * @description Ссылка на платформу
         * @readonly
         */
        readonly url: string;

        /**
         * @description Цвет платформы, в стиле discord
         * @readonly
         */
        readonly color: number;
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @class API
     * @implements APIBase
     * @public
     */
    export class API implements APIBase {
        /**
         * @description Название платформы
         * @readonly
         */
        readonly name: RestAPIS_Names;

        /**
         * @description Ссылка на платформу
         * @readonly
         */
        readonly url: string;

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
        readonly auth?: string;

        /**
         * @description Regexp для поиска платформы
         * @readonly
         */
        readonly filter: RegExp;

        /**
         * @description Запросы к данных платформы
         * @readonly
         */
        readonly requests: (RequestDef<"track"> | RequestDef<"search"> | RequestDef<"artist"> | RequestDef<"related"> | RequestDef<"album"> | RequestDef<"playlist">)[];

        /**
         * @description Доп параметры
         * @readonly
         */
        readonly options: any;

        /**
         * @description Получение ID по ссылке
         * @param regexp - Как искать ID
         * @param query - Запрос
         * @protected
         */
        protected getID(regexp: RegExp, query: string): string {
            return (regexp).exec(query)[0];
        };

        /**
         * @description Функция запроса данных с сервера
         * @constructor
         * @protected
         */
        protected async API(...args: any): Promise<Error | json> {
            return new Error(`Not found method API | ${args}`);
        };

        /**
         * @description Функция авторизации платформы
         * @protected
         */
        protected async authorization(){
            return null;
        };

        /**
         * @description Функция подготовки данных трека
         * @param _ - Данные трека
         * @constructor
         * @protected
         */
        protected track(_: json): APIRequestsRaw["track"] {
            return null;
        };
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

        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array?: RestServerSide.API[]
    }
}

/**
 * @description Если запрос обработан без ошибок
 * @type ResultSuccess
 * @private
 */
type ResultSuccess<T extends keyof APIRequests = keyof APIRequests> = {
    status: "success";
    type: T;
    result: APIRequestsRaw[T];
};

/**
 * @description Если запрос обработан без ошибок
 * @type ResultError
 * @private
 */
type ResultError = {
    status: "error";
    result: Error;
};