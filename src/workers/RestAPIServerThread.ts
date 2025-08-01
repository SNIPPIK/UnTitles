import { parentPort, workerData } from "node:worker_threads";
import type { RestServerSide } from "#handler/rest";
import { initDatabase } from "#app/db";
import { handler } from "#handler";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class RestServer
 * @extends handler
 * @private
 */
class RestServer extends handler<RestServerSide.API> {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    public readonly platforms: RestServerSide.Data = {
        supported: null,
        authorization: [],
        audio: [],
        block: []
    };

    /**
     * Лимиты на количество обрабатываемых элементов для различных типов запросов.
     * Значения читаются из переменных окружения.
     * @type {Record<string, number>}
     */
    public readonly limits: Record<string, number> = ((): Record<string, number> => {
        const keys = ["playlist", "album", "search", "author"];
        return keys.reduce((acc, key) => {
            acc[key] = parseInt(env.get(`APIs.limit.${key}`));
            return acc;
        }, {} as Record<string, number>);
    })();

    /**
     * @description Исключаем платформы из общего списка
     * @public
     */
    public get allow(): RestServerSide.API[] {
        return Object.values(this.platforms.supported).filter(api => api.auth);
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
     * @description Получаем платформу
     * @param name - Имя платформы
     * @public
     */
    public platform = (name: RestServerSide.API["name"] | string) => {
        const platform = this.platforms.supported[name];

        // Если есть такая платформа по имени
        if (platform) return platform;

        return this.allow.find((api) => !!api.filter.exec(name) || name === api.name);
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
            if (!file.auth) this.platforms.authorization.push(file.name);
            if (!file.audio) this.platforms.audio.push(file.name);

            this.platforms.supported = {
                ...this.platforms.supported,
                [file.name]: file
            }
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
        // Запускаем Garbage Collector
        setImmediate(() => {
            if (global.gc) global.gc();
        });

        // Если запрос к платформе
        if (message.platform) return ExtractDataFromAPI(message);

        // Если надо выдать данные о загруженных платформах
        else if (message.data) return ExtractData();
    });

    // Если возникнет непредвиденная ошибка
    process.on("unhandledRejection", (err) => {
        throw err;
    });
}

/**
 * @author SNIPPIK
 * @description Получения json данных из платформ
 * @param api - Данные для успешного запроса
 * @returns Promise<void>
 * @function ExtractDataFromAPI
 * @async
 */
async function ExtractDataFromAPI(api: RestServerSide.ServerOptions) {
    try {
        const { platform, payload, options } = api;
        const readPlatform: RestServerSide.API = rest.platform( payload?.startsWith("http") ? payload : platform );
        const callback = readPlatform.requests.find((p) => {
            // Если производится прямой запрос по названию
            if (p.name === payload) return p;

            // Если указана ссылка
            else if (payload.startsWith("http")) {
                try {
                    if (p["filter"].exec(payload) || payload.match(p["filter"])) return p;
                } catch {
                    return null;
                }
            }

            // Скорее всего надо произвести поиск
            return p.name === "search";
        });

        // Если не найдена функция вызова
        if (!callback) {
            return parentPort.postMessage({status: "error", result: Error(`Callback not found for platform: ${platform}`)});
        }

        // Получаем результат запроса
        const result = await callback.execute(payload, {
            audio: options?.audio !== undefined ? options.audio : true,
            limit: rest.limits[callback.name]
        });

        return parentPort.postMessage({ status: "success", result, type: callback.name });
    } catch (err) {
        parentPort.postMessage({status: "error", result: err});
        throw new Error(`${err}`);
    }
}

/**
 * @author SNIPPIK
 * @description Выдача найденных платформ без функций запроса
 * @returns Promise<void>
 * @function ExtractData
 * @async
 */
async function ExtractData() {
    const fakeReq = rest.allow.map(api => ({...api,
        requests: api.requests.map(request => {
            return {
                ...request,
                execute: null,
            }
        })
    }));

    parentPort?.postMessage({
        supported: fakeReq.map(api => [api.name, api]),
        authorization: fakeReq.filter(api => !api.auth).map(api => api.name),
        audio: fakeReq.filter(api => api.audio === false).map(api => api.name),
        block: []
    });
}