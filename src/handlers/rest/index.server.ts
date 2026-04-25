import { type APIExecuteParams, APIPlatformType, type APIRequestsKeys, type APIRequestsRaw, RestAPIAgent } from "./index.js";
import type { RestAPINames, RestOptions } from "./index.decorator.js";
import type { RestClientSide } from "./index.client.js";

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
    export type APIs = Record<RestAPINames, API>;

    /**
     * @description Данные для валидного запроса параллельном процессу
     * @type ServerOptions
     * @public
     */
    export type ServerOptions = RestClientSide.ClientOptions & {
        // Название платформы
        platform: RestAPINames;

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
    export type Result<T extends APIRequestsKeys> = {
        // Номер уникального запроса
        requestId: number;
    } & (ResultSuccess<T> | ResultError);

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
         * @description Regexp для поиска платформы
         * @readonly
         */
        readonly filter: RegExp;

        /**
         * @description Запросы к данных платформы
         * @readonly
         */
        readonly requests: (RequestDef<"all"> | RequestDef<"track"> | RequestDef<"search"> | RequestDef<"artist"> | RequestDef<"related"> | RequestDef<"album"> | RequestDef<"playlist">)[];

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
            return this.proxy ? RestAPIAgent : null;
        };

        /**
         * @description Получение ID по ссылке
         * @param regexp - Как искать ID
         * @param query - Запрос
         * @protected
         */
        protected getID?(regexp: RegExp, query: string) {
            return (regexp).exec(query);
        };

        /**
         * @description Функция запроса данных с сервера
         * @constructor
         * @protected
         */
        protected async API?(...args: any): Promise<Error | json> {
            return new Error(`Not found method API | ${args}`);
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
     * @description Доступные запросы для платформ
     * @interface RequestDef
     * @public
     */
    export interface RequestDef<T extends APIRequestsKeys> {
        name: T;
        filter?: RegExp;
        execute: (url: string, options: APIExecuteParams<T>) => Promise<APIRequestsRaw<T> | Error>;
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
        array?: RestServerSide.API[],

        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array_tex?: RestServerSide.API[]
    }
}

/**
 * @description Если запрос обработан без ошибок
 * @type ResultSuccess
 * @private
 */
type ResultSuccess<T extends APIRequestsKeys> = {
    status: "success";
    type: T;
    result: APIRequestsRaw<T>;
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