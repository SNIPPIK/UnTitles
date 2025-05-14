import { parentPort, isMainThread } from 'node:worker_threads';
import type {RestServerSide} from "@handler/rest/apis";
import {handler} from "@handler";
import {env} from "@app/env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class RestServer
 * @private
 */
class RestServer extends handler<RestServerSide.API> {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    public readonly platforms: RestServerSide.Data = {
        supported: this.files,
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
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        super("src/handlers/rest/apis");
        this.register();
    };

    /**
     * @description Функция загрузки api запросов
     * @public
     */
    public register = () => {
        this.load();

        // Загружаем команды в текущий класс
        for (let file of this.files) {
            if (!file.auth) this.platforms.authorization.push(file.name);
            if (!file.audio) this.platforms.audio.push(file.name);
        }
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @return APIRequest
     * @public
     */
    public request(name: RestServerSide.API["name"]): RestRequest | null {
        const platform = this.files.find(file => file.name === name);
        return platform ? new RestRequest(platform) : null;
    };
}

/**
 * @author SNIPPIK
 * @description Получаем ответ от локальной базы APIs
 * @class RestRequest
 * @private
 */
class RestRequest {
    /**
     * @description Выдаем название
     * @return API.platform
     * @public
     */
    public get platform() { return this._api.name; };

    /**
     * @description Ищем платформу из доступных
     * @param _api - Имя платформы
     * @public
     */
    public constructor(private readonly _api: RestServerSide.API) {};

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {get} Тип запроса
     * @public
     */
    public get<T extends (RestServerSide.APIs.track | RestServerSide.APIs.playlist | RestServerSide.APIs.album | RestServerSide.APIs.artist | RestServerSide.APIs.search)["name"]>(type: T | string) {
        return this._api.requests.find((item) => {
            // Если производится прямой запрос по названию
            if (item.name === type) return item;

            // Если указана ссылка
            else if (type.startsWith("http")) {
                try {
                    if (item["filter"].exec(type) || type.match(item["filter"])) return item;
                } catch {
                    return null;
                }
            }

            // Скорее всего надо произвести поиск
            return item.name === "search";
        }) as RestServerSide.ResultAPIs<T>;
    };
}



// Если это главный поток
if (!isMainThread) {
    const ServerRest = new RestServer();
    parentPort.on("message", async (message) => {
        // Если запрос к платформе
        if (message.platform) {
            try {
                const {platform, payload, options} = message;

                const thePlatform = ServerRest.request(platform);
                const rest = thePlatform.get(typeof payload === "string" ? payload : payload?.url);
                const result = await rest.execute(payload, {
                    audio: options?.audio !== undefined ? options.audio : true,
                    limit: ServerRest.limits[rest.name]
                });

                parentPort.postMessage({type: rest.name, status: "success", result});
            } catch (err) {
                parentPort.postMessage({status: "error", result: `${err}`});
            }
        }

        // Если надо выдать данные о загруженных платформах
        else if (message.data) {
            const fake = ServerRest.platforms.supported;
            const fakeReq = [];

            for (let i = 0; i < fake.length; i++) {
                const sanitizedRequests = fake[i].requests.map(request => {
                    const sanitized = { ...request };
                    for (const key in sanitized) {
                        if (typeof sanitized[key] === "function") {
                            delete sanitized[key];
                        }
                    }
                    return sanitized;
                });

                fakeReq.push({
                    ...fake[i],
                    requests: sanitizedRequests,
                });
            }

            parentPort.postMessage({
                ...ServerRest.platforms,
                supported: fakeReq,
            });

        }
    });

    process.on("unhandledRejection", (err) => {
        throw err;
    });
}