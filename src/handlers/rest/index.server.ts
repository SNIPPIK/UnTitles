import { type APIExecuteParams, APIPlatformType, type APIRequestsKeys, type APIRequestsRaw } from "./index.js";
import type { RestOptions } from "./index.decorator.js";
import type { RestAPINames } from "./index.abstract.js";
import type { RestClientSide } from "./index.client.js";
import { sdb } from "#worker/db";

/**
 * @author SNIPPIK
 * @description Данные для работы серверной части (Worker)
 * @namespace RestServerSide
 * @public
 */
export namespace RestServerSide {
    /**
     * @description Запросы в формате Object
     * @type APIs
     * @public
     */
    export type APIs = Record<RestAPINames, API>;

    /**
     * @description Данные класса для работы с Rest/API
     * @interface RestDatabase
     * @public
     */
    export interface RestDatabase {
        /**
         * @description Все загруженные платформы
         * @protected
         */
        supported: APIs;

        /**
         * @description Платформы с данных для авторизации
         * @protected
         */
        authorization: RestAPINames[];

        /**
         * @description Платформы с возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: RestAPINames[];

        /**
         * @description Платформы с возможностью получать похожие треки
         * @protected
         */
        related: RestAPINames[];

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: RestAPINames[];

        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array?: RestServerSide.API[];

        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array_tex?: RestServerSide.API[];
    }

    /**
     * @description Данные для валидного запроса параллельном процессу
     * @type ServerOptions
     * @public
     */
    export type ServerOptions = RestClientSide.ClientOptions & {
        // Название платформы
        platform: RestAPINames;

        // Надо ли получить данные в ответ
        data?: boolean;

        // Номер уникального запроса
        requestId: number;
    };

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @class API
     * @implements RestOptions
     * @public
     */
    export class API<T = any> implements RestOptions {
        /**
         * @description Название платформы
         * @readonly
         */
        readonly name: RestAPINames;

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
        readonly auth?: boolean;

        /**
         * @description Может ли платформа запрашивать повторное получение аудио
         * @default false - разово
         * @readonly
         */
        readonly retry?: boolean;

        /**
         * @description Regexp для поиска платформы
         * @readonly
         */
        readonly filter: RegExp;

        /**
         * @description Запросы к данных платформы
         * @readonly
         */
        readonly requests: (Request<"all"> | Request<"track"> | Request<"search"> | Request<"artist"> | Request<"related"> | Request<"album"> | Request<"playlist">)[];

        /**
         * @description Если надо использовать прокси при запросах
         * @protected
         */
        readonly proxy: boolean;

        /**
         * @description Доп параметры
         * @readonly
         */
        readonly options: T;

        /**
         * @description Тип платформы, платформа может быть технической или же прямой
         * @default APIPlatformType.primary
         * @readonly
         */
        readonly type: APIPlatformType = APIPlatformType.primary;

        /**
         * @description Выдача прокси агента
         * @protected
         */
        protected get agent() {
            return this.proxy ? sdb.proxy : null;
        };

        /**
         * @description Получение ID по ссылке
         * @param regexp - Как искать ID
         * @param query - Запрос
         * @protected
         */
        protected getID?(regexp: RegExp, query: string) {
            try {
                return (regexp).exec(query);
            } catch {
                return query?.split("/")?.at(-1);
            }
        };

        /**
         * @description Функция запроса данных с сервера
         * @constructor
         * @protected
         */
        protected async API?(...args: any): Promise<Error | json> {
            return Error(`Not found method API | ${args}`);
        };

        /**
         * @description Функция авторизации платформы
         * @protected
         */
        protected async authorization?(): Promise<string | Error> {
            return null;
        };

        /**
         * @description Функция подготовки данных трека
         * @param _ - Данные трека
         * @constructor
         * @protected
         */
        protected track?(_: json): APIRequestsRaw<"track"> {
            return null;
        };
    }

    /**
     * @description Рекурсивно проходит по всему объекту, оставляя только сериализуемые
     * @type Serializable
     * @public
     */
    export type Serializable<T> = T extends Function ? never : T extends object ? { [K in keyof T]: Serializable<T[K]> } : T;

    /**
     * @description Доступные запросы для платформ
     * @interface Request
     * @public
     */
    interface Request<T extends APIRequestsKeys> {
        /** Имя запроса */
        name: T;

        /**
         * @description Фильтр для поиска через ссылку
         * @warn Для search запросов данный параметр не требуется
         */
        filter?: RegExp;

        /**
         * @description Функция запроса, основной код для получения данных от запроса
         * @param url - Ссылка или для поиска строка
         * @param options - Параметры передаваемые при запросе
         * @returns Promise<APIRequestsRaw<T> | Error>
         */
        execute: (url: string, options: APIExecuteParams<T>) => Promise<APIRequestsRaw<T> | Error>;
    }
}