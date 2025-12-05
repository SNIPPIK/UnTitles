import { parentPort, workerData } from "node:worker_threads";
import type { RestServerSide } from "./index.server";
import { initDatabase } from "#app/db";
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
    public readonly platforms: RestServerSide.Data = {
        supported: {} as RestServerSide.APIs,
        authorization: [],
        audio: [],
        related: [],
        block: []
    };

    /**
     * Лимиты на количество обрабатываемых элементов для различных типов запросов.
     * Значения читаются из переменных окружения.
     * @type {Record<string, number>}
     * @readonly
     * @public
     */
    public readonly limits: Record<string, number> = ((): Record<string, number> => {
        const keys = ["playlist", "album", "search", "author"];
        return keys.reduce((acc, key) => {
            acc[key] = parseInt(env.get(`APIs.limit.${key}`));
            return acc;
        }, {} as Record<string, number>);
    })();

    /**
     * @description Получаем список всех доступных платформ
     * @returns RestServerSide.API[]
     * @private
     */
    private get array(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported).sort((a, b) => a.name.localeCompare(b.name));
        return this.platforms.array;
    };

    /**
     * @description Исключаем платформы из общего списка
     * @returns RestServerSide.API[]
     * @public
     */
    public get allow(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null && !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к похожим трекам
     * @returns RestServerSide.API[]
     * @public
     */
    public get allowRelated(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null && api.requests.some((apis) => apis.name === "related"));
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
    public register = () => {
        this.load();

        // Загружаем команды в текущий класс
        for (let file of this.files) {
            if (file.auth !== null) this.platforms.authorization.push(file.name);
            if (file.audio) this.platforms.audio.push(file.name);
            if (file.requests.find((req) => req.name === "related")) this.platforms.related.push(file.name);

            this.platforms.supported = {
                ...this.platforms.supported,
                [file.name]: file
            };
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
    initDatabase(null);
    rest = new RestServer();

    // Получаем ответ от основного потока
    parentPort.on("message", (message: RestServerSide.ServerOptions): Promise<void> | void => {
        // Если запрос к платформе
        if (message.platform) return fetchFromPlatform(message);

        // Если надо выдать данные о загруженных платформах
        else if (message.data) return fetchPlatforms();
    });

    // Если возникнет непредвиденная ошибка
    process.on("unhandledRejection", (err) => {
        parentPort?.postMessage({ status: "error", result: err });
    });
}

/**
 * @author SNIPPIK
 * @description Удаление функций для SharedMemory
 * @param obj - Данные запроса из Rest API
 * @private
 */
function stripFunctions<T extends object>(obj: T) {
    return Object.fromEntries(Object.entries(obj).filter(([_, v]) => typeof v !== "function")) as RestServerSide.Serializable<T>;
}

/**
 * @author SNIPPIK
 * @description Получения json данных из платформ
 * @param api - Данные для успешного запроса
 * @returns Promise<void>
 * @function fetchFromPlatform
 * @async
 */
async function fetchFromPlatform(api: RestServerSide.ServerOptions) {
    const { platform, payload, options, requestId, type } = api;

    try {
        const restPlatform = rest.platforms.supported[platform] as RestServerSide.API;

        // Если нет типа
        if (!type) return parentPort.postMessage({requestId, status: "error", result: Error(`Unknown request type for payload: ${payload}`)});

        const callback = restPlatform.requests.find((request) => request.name === type);

        // Если не найдена функция вызова
        if (!callback) return parentPort.postMessage({requestId, status: "error", result: Error(`Callback not found for platform: ${platform}`)});

        const result = await callback.execute(payload, {
            audio: options?.audio !== undefined ? options.audio : true,
            limit: rest.limits[callback.name]
        });

        // Если была получена ошибка
        if (result instanceof Error) {
            return parentPort.postMessage({ requestId,
                status: "error",
                result
            });
        }

        // Если запрос успешен
        return parentPort.postMessage({ requestId,
            type: callback.name,
            status: "success",
            result
        });
    } catch (err: any) {
        parentPort.postMessage({
            status: "error",
            requestId,
            result: { name: err.name, message: err.message, stack: err.stack }
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
async function fetchPlatforms() {
    const fakeReq = rest.allow.map(api => ({
        ...stripFunctions(api),
        requests: (api.requests ?? []).map(stripFunctions)
    }));

    // Отдаем данные в другой поток
    parentPort?.postMessage({
        supported: fakeReq,
        authorization: fakeReq.filter(api => api.auth !== null).map(api => api.name),
        audio: fakeReq.filter(api => api.audio).map(api => api.name),
        related: rest.allowRelated.map(api => api.name),
        block: []
    });
}