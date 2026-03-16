import { parentPort, workerData } from "node:worker_threads";
import type { APIRequestsLimits } from "#handler/rest";
import type { RestServerSide } from "./index.server";
import { initSharedDatabase } from "#worker/db";
import { handler } from "#handler";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class RestServer
 * @extends handler<RestServerSide.API>
 * @private
 */
class RestServer extends handler<RestServerSide.API> {
    /**
     * @description База с платформами
     * @readonly
     * @public
     */
    public readonly platforms: RestServerSide.Data & { array: RestServerSide.API[] } = {
        supported: {} as RestServerSide.APIs,
        authorization: [],
        audio: [],
        related: [],
        block: [],
        array: null
    };

    /**
     * Лимиты на количество обрабатываемых элементов для различных типов запросов.
     * Значения читаются из переменных окружения.
     * @readonly
     * @public
     */
    public readonly limits: Record<APIRequestsLimits, number> = (() => {
        const keys: APIRequestsLimits[] = ["playlist", "album", "search", "artist", "related"];
        const obj = {} as Record<APIRequestsLimits, number>;
        for (const key of keys) {
            obj[key] = parseInt(env.get(`APIs.limit.${key}`, "10"));
        }
        return obj;
    })();

    /**
     * @description Получаем список всех доступных платформ
     * @returns RestServerSide.API[]
     * @private
     */
    private get array(): RestServerSide.API[] {
        if (!this.platforms?.array) {
            this.platforms.array = Object.values(this.platforms.supported)
                .sort((a, b) => a.name.localeCompare(b.name));
        }
        return this.platforms.array;
    };

    /**
     * @description Исключаем платформы из общего списка
     * @returns RestServerSide.API[]
     * @public
     */
    public get allow(): RestServerSide.API[] {
        return this.array.filter(api => !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к похожим трекам
     * @returns RestServerSide.API[]
     * @public
     */
    public get allowRelated(): RestServerSide.API[] {
        return this.array.filter(api =>
            api.requests?.some((req) => req.name === "related")
        );
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @constructor
     * @public
     */
    public constructor() {
        super("src/handlers/rest");
        this.register();
    };

    /**
     * @description Функция загрузки api запросов
     * @returns void
     * @public
     */
    public register(): void {
        this.load();

        // Загружаем команды в текущий класс
        for (const file of this.files) {
            if (file.auth !== null) this.platforms.authorization.push(file.name);
            if (file.audio) this.platforms.audio.push(file.name);
            if (file.requests?.find((req) => req.name === "related")) {
                this.platforms.related.push(file.name);
            }

            this.platforms.supported[file.name] = file;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Делаем класс RestServer глобальным
 * @private
 */
let rest: RestServer;

/**
 * @author SNIPPIK
 * @description Не даем запустить без необходимости
 * @private
 */
if (parentPort && workerData.rest) {
    initSharedDatabase();
    rest = new RestServer();

    // Получаем ответ от основного потока
    parentPort.on("message", async (message: RestServerSide.ServerOptions) => {
        try {
            // Если запрос к платформе
            if (message.platform) return await fetchFromPlatform(message);

            // Если надо выдать данные о загруженных платформах
            else if (message.data) return fetchPlatforms();

            parentPort.postMessage({
                status: "error",
                requestId: message.requestId,
                result: new Error("Dont support this request")
            });
        } catch (error) {
            parentPort?.postMessage({
                requestId: message.requestId,
                status: "error",
                result: error
            });
        }
    });

    // Если возникнет непредвиденная ошибка
    process.on("unhandledRejection", (err) => {
        parentPort?.postMessage({
            requestId: undefined,
            status: "error",
            result: err
        });
    });
}

/**
 * @author SNIPPIK
 * @description Удаление функций для SharedMemory
 * @param obj - Данные запроса из Rest API
 * @private
 */
function stripFunctions<T extends object>(obj: T): RestServerSide.Serializable<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => typeof v !== "function")
    ) as RestServerSide.Serializable<T>;
}

/**
 * @author SNIPPIK
 * @description Получения json данных из платформ
 * @param api - Данные для успешного запроса
 * @returns Promise<void>
 * @function fetchFromPlatform
 * @async
 */
async function fetchFromPlatform(api: RestServerSide.ServerOptions): Promise<void> {
    const { platform, payload, options, requestId, type } = api;

    try {
        const restPlatform = rest.platforms.supported[platform] as RestServerSide.API;
        if (!restPlatform) {
            return parentPort.postMessage({
                requestId,
                status: "error",
                result: new Error(`Platform not found: ${platform}`)
            });
        }

        const callback = restPlatform.requests?.find((request) =>
            request.name === "all" || request.name === type
        );

        // Если не найдена функция вызова
        if (!callback) {
            return parentPort.postMessage({
                requestId,
                status: "error",
                result: new Error(`Callback not found for platform: ${platform}`)
            });
        }

        const result = await callback.execute(payload, {
            audio: options?.audio !== undefined ? options.audio : true,
            limit: rest.limits[callback.name]
        });

        // Если была получена ошибка
        if (result instanceof Error) {
            return parentPort.postMessage({
                requestId,
                status: "error",
                result
            });
        }

        // Если запрос успешен
        return parentPort.postMessage({
            requestId,
            type: callback.name,
            status: "success",
            result
        });
    } catch (err: any) {
        parentPort.postMessage({
            status: "error",
            requestId,
            result: {
                name: err.name,
                message: err.message,
                stack: err.stack
            }
        });
    }
}

/**
 * @author SNIPPIK
 * @description Выдача найденных платформ без функций запроса
 * @returns Promise<void>
 * @function fetchPlatforms
 * @async
 */
async function fetchPlatforms(): Promise<void> {
    const fakeReq = rest.allow.map(api => ({
        ...stripFunctions(api),
        requests: (api.requests ?? []).map(stripFunctions)
    }));

    const response = {
        supported: fakeReq,
        authorization: fakeReq.filter(api => api.auth !== null).map(api => api.name),
        audio: fakeReq.filter(api => api.audio).map(api => api.name),
        related: rest.allowRelated.map(api => api.name),
        block: []
    };

    // Отдаем данные в другой поток
    parentPort?.postMessage(response);
}