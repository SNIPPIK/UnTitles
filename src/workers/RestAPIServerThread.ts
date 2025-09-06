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
    public readonly platforms: RestServerSide.Data & {
        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array?: RestServerSide.API[]
    } = {
        supported: null,
        authorization: [],
        audio: [],
        related: [],
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
     * @description Получаем список всех доступных платформ
     * @private
     */
    private get array(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported).sort((a, b) => a.name.localeCompare(b.name));
        return this.platforms.array;
    };

    /**
     * @description Исключаем платформы из общего списка
     * @public
     */
    public get allow(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null);
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
            if (file.auth !== null) this.platforms.authorization.push(file.name);
            if (file.audio) this.platforms.audio.push(file.name);
            if (file.requests.find((req) => req.name === "related")) this.platforms.related.push(file.name);

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
        // Если запрос к платформе
        if (message.platform) return ExtractDataFromAPI(message);

        // Если надо выдать данные о загруженных платформах
        else if (message.data) return ExtractData();
    });

    // Если возникнет непредвиденная ошибка
    process.on("unhandledRejection", (err) => {
        parentPort.removeAllListeners();
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
    const { platform, payload, options, requestId } = api;

    try {
        const readPlatform: RestServerSide.API = rest.platform( platform );
        const callback = readPlatform.requests.find((p) => {
            // Если производится прямой запрос по названию
            if (p.name === payload) return true;

            // Если указана ссылка
            else if (payload.startsWith("http")) {
                try {
                    return p["filter"]?.test(payload);
                } catch {
                    return false;
                }
            }

            // Скорее всего надо произвести поиск
            return p.name === "search";
        });

        // Если не найдена функция вызова
        if (!callback) return parentPort.postMessage({requestId, status: "error", result: Error(`Callback not found for platform: ${platform}`)});

        return parentPort.postMessage({ requestId,
            type: callback.name,
            status: "success",
            result: await callback.execute(payload, {
                audio: options?.audio !== undefined ? options.audio : true,
                limit: rest.limits[callback.name]
            })
        });
    } catch (err) {
        parentPort.postMessage({status: "error", result: err, requestId});
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
    const fakeReq = rest.allow.map(api => {
        // Удаляем все поля-функции на верхнем уровне
        const safeApi = Object.fromEntries(
            Object.entries(api).filter(([_, v]) => typeof v !== "function")
        );

        // Обрабатываем requests
        safeApi.requests = (api.requests ?? []).map(request =>
            Object.fromEntries(
                Object.entries(request).filter(([_, v]) => typeof v !== "function")
            )
        );

        return safeApi;
    });

    parentPort?.postMessage({
        supported: fakeReq,
        authorization: fakeReq.filter(api => api.auth !== null).map(api => api.name),
        audio: fakeReq.filter(api => api.audio).map(api => api.name),
        related: rest.allowRelated.map(api => api.name),
        block: []
    });
}