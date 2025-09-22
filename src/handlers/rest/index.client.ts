import type { RestServerSide } from "./index.server";
import type { APIRequests } from "./index";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Данные для работы в основной системе бота
 * @namespace RestClientSide
 * @public
 */
export namespace RestClientSide {
    /**
     * @description Данные для валидного запроса параллельному процессу
     * @interface ClientOptions
     */
    export interface ClientOptions {
        requestId: string
        platform: RestServerSide.APIBase
        payload: string
        options?: { audio?: boolean; limit?: number }
    }

    /**
     * @description Класс для взаимодействия с конкретной платформой
     * @class ClientRestRequest
     * @private
     */
    export class Request {
        /**
         * @description Выдаем название
         * @return API.platform
         * @public
         */
        public get platform() {
            return this._api.name;
        };

        /**
         * @description Выдаем bool, Недоступна ли платформа
         * @return boolean
         * @public
         */
        public get block() {
            return db.api.platforms.block.includes(this._api.name);
        };

        /**
         * @description Выдаем bool, есть ли доступ к платформе
         * @return boolean
         * @public
         */
        public get auth() {
            return this._api.auth !== null;
        };

        /**
         * @description Выдаем bool, есть ли доступ к получению аудио у платформы
         * @return boolean
         * @public
         */
        public get audio() {
            return this._api.audio;
        };

        /**
         * @description Выдаем int, цвет платформы
         * @return number
         * @public
         */
        public get color() {
            return this._api.color;
        };

        /**
         * @description Ищем платформу из доступных
         * @param _api - Данные платформы
         * @public
         */
        public constructor(private _api: RestServerSide.API) {};

        /**
         * @description Запрос в систему Rest/API, через систему worker
         * @param payload - Данные для отправки
         * @param options - Параметры для отправки
         */
        public request<T extends keyof APIRequests>(payload: string, options?: { audio: boolean }) {
            const api  = this._api;

            return {
                // Получение типа запроса
                type: api.requests.find((item) => {
                    return item.name === payload || typeof payload === "string" && payload.startsWith("http") && item.filter?.test(payload) || item.name === "search"
                })?.name,

                // Функция запроса на Worker для получения данных
                request: () => db.api["request_worker"]<T>(
                    {
                        // Присваивается в request_worker
                        requestId: null,
                        platform: api, payload, options
                    }
                )
            }

        };
    }
}