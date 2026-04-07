import type { RestServerSide } from "./index.server";
import type { APIRequestsKeys } from "./index";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Пространство имён для клиентской части REST API.
 * Содержит типы и классы, необходимые для формирования и отправки запросов к воркеру.
 */
export namespace RestClientSide {
    /**
     * @author SNIPPIK
     * @description Параметры запроса, отправляемого в воркер.
     */
    export interface ClientOptions {
        /** Платформа, к которой выполняется запрос (YouTube, Spotify и т.д.) */
        platform: RestServerSide.API;
        /** Тип запроса (search, track, related, playlist и т.п.) */
        type: APIRequestsKeys;
        /** Уникальный идентификатор запроса (опционально, может быть сгенерирован автоматически) */
        requestId?: string;
        /** Строка полезной нагрузки: URL трека, поисковый запрос, ID плейлиста и т.д. */
        payload: string;
        /** Дополнительные опции, например, { audio: true } для получения прямой ссылки */
        options?: { audio?: boolean };
    }

    /**
     * @author SNIPPIK
     * @description Класс-обёртка для выполнения запросов к конкретной платформе.
     * Позволяет удобно получать информацию о платформе (имя, блокировка, поддержка аудио)
     * и формировать запрос с автоматическим определением типа.
     */
    export class Request {
        /**
         * @description Имя платформы (например, "YOUTUBE").
         */
        public get platform() { return this._api.name; }

        /**
         * @description Заблокирована ли платформа в текущей сессии.
         * Если true, запросы на эту платформу не будут выполняться (пока блок не сбросится).
         */
        public get block() { return db.api.platforms.block.includes(this._api.name); }

        /**
         * @description Требуется ли авторизация для работы с этой платформой.
         */
        public get auth() { return this._api.auth !== null; }

        /**
         * @description Поддерживает ли платформа аудио-ссылку (может вернуть прямой URL).
         */
        public get audio() { return this._api.audio; }

        /**
         * @description Цветовой код платформы (используется в UI).
         */
        public get color() { return this._api.color; }

        /**
         * @constructor
         * @param _api - Объект API платформы, полученный от серверной части.
         */
        public constructor(private _api: RestServerSide.API) {}

        /**
         * @description Создаёт объект запроса к платформе.
         * @param payload - Строка запроса: может быть URL трека, поисковая фраза, ID плейлиста и т.д.
         * @param options - Дополнительные параметры, например, { audio: true }.
         * @returns Объект с полем `type` (определённый тип запроса) и методом `request()`,
         *          который возвращает Promise с результатом.
         *
         * @remarks
         * Алгоритм определения типа запроса:
         * 1. Ищется запрос, у которого имя совпадает с payload (например, "search").
         * 2. Если payload начинается с "http", проверяется, подходит ли он под регулярное выражение
         *    какого-либо из поддерживаемых типов (например, filter для "track").
         * 3. Fallback: если ничего не найдено, используется тип "search".
         * 4. Если и search не подошёл, берётся тип "all" (обычно для универсальных запросов).
         *
         * @example
         * ```typescript
         * const req = new Request(youtubeApi);
         * const { type, request } = req.request("https://youtu.be/...", { audio: true });
         * console.log(type); // "track"
         * const track = await request();
         * ```
         */
        public request<T extends APIRequestsKeys>(payload: string, options?: { audio: boolean }) {
            const platform = this._api;

            // Определяем тип запроса на основе payload и настроек платформы
            const type = platform.requests.find((item) =>
                // 1) Прямое совпадение имени запроса с payload (например, "search")
                item.name === payload ||
                // 2) Если payload — URL, проверяем по регулярному выражению типа (например, для track)
                (typeof payload === "string" && payload.startsWith("http") && item.filter?.test(payload)) ||
                // 3) Fallback: ищем тип "search"
                item.name === "search"
            )?.name || "all"; // 4) Если ничего не подошло — используем "all"

            return {
                type,
                // Функция, выполняющая фактический запрос через глобальный RestObject
                request: () => db.api.request_worker<T>({ platform, payload, options, type })
            };
        }
    }
}