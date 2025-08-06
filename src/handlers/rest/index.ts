import { Logger, SimpleWorker } from "#structures";
import { Worker } from "node:worker_threads";
import { Track } from "#core/queue";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Коллекция базы данных для взаимодействия с Rest/API
 * @class RestObject
 * @public
 */
export class RestObject {
    /**
     * @description Второстепенный поток, динамически создается и удаляется когда не требуется
     * @readonly
     * @private
     */
    private worker: Worker;

    /**
     * @description Последний уникальный ID запроса
     * @private
     */
    private lastID = 0;

    /**
     * @description База с платформами
     * @public
     */
    public platforms: RestServerSide.Data & {
        /**
         * @description Поддерживаемые платформы в array формате, для экономии памяти
         * @private
         */
        array?: RestServerSide.API[]
    };

    /**
     * @description Платформы с доступом к запросам
     * @returns RestServerSide.API[]
     * @public
     */
    public get allow(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth);
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get audioSupport(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth !== false && api.audio !== false && !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к потоку
     * @returns RestServerSide.API[]
     * @public
     */
    public get allowWave(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth && api.requests.some((apis) => apis.name === "wave"));
    };

    /**
     * @description Генерация уникального ID
     * @param reset
     */
    private generateUniqueId = (reset = false) => {
        // Если надо сбросить данные
        if (reset) {
            this.lastID = 0;
            return null;
        }

        // Если большое кол-во запросов
        if (this.lastID >= 2 ** 16) this.generateUniqueId(true);

        this.lastID += 1;
        return this.lastID.toString();
    };

    /**
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public startWorker = async (): Promise<boolean> => {
        this.generateUniqueId(true);

        return new Promise(resolve => {
            const worker = this.worker = SimpleWorker.create<RestServerSide.Data>({
                file: "src/workers/RestAPIServerThread",
                options: {
                    execArgv: ["-r", "tsconfig-paths/register"],
                    workerData: { rest: true }
                },
                postMessage: { data: true },
                not_destroyed: true,
                callback: (data) => {
                    this.platforms = {
                        ...data,
                        supported: Object.fromEntries(data.supported as any) as any
                    };

                    return resolve(true);
                }
            });

            // Если возникнет ошибка, пересоздадим worker
            worker.once("error", () => {
                return this.startWorker();
            });
        });
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @returns Promise<string | Error>
     * @public
     */
    public fetch = async (track: Track): Promise<string | Error> => {
        try {
            const { name, artist, url, api } = track;
            const { authorization, audio } = this.platforms;

            // Если платформа поддерживает получение аудио и может получать данные
            if (!authorization.includes(api.name) && !audio.includes(api.name)) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();

                // Если получили ошибку
                if (song instanceof Error) return null;

                track["_duration"] = song.time;
                return song.link;
            }

            let link: string = null, lastError: Error;

            // Оригинальный трек по словам
            const original = track.name.toLowerCase().replace(/[^\w\s]|_/gi, "").replace(/\s+/gi, " ").split(" ");

            // Ищем нужную платформу
            for (const platform of this.audioSupport) {
                // Делаем запрет на поиск на той же платформе
                if (platform.name === track.api.name) continue;

                // Получаем класс для работы с Worker
                const platformAPI = this.request(platform.name);

                // Если нет такой платформы
                if (!platformAPI) continue;

                // Поиск трека
                const search = await platformAPI.request<"search">(`${name} ${artist.title}`).request();

                // Если при получении треков произошла ошибка
                if (search instanceof Error) {
                    Logger.log("ERROR", search);
                    lastError = search;
                    continue;
                }

                // Если треков не найдено
                else if (!search.length) {
                    Logger.log("DEBUG", `[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                    lastError = Error(`[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                    continue;
                }

                // Ищем нужный трек
                // Можно разбить проверку на слова, сравнивать кол-во совпадений, если больше половины то точно подходит
                const findTrack = search.filter((song) => {
                    const title = song.name.toLowerCase().replace(/[^\w\s]|_/gi, "").replace(/\s+/gi, " ").split(" ")
                        .map((x) => original.includes(x));
                    const time = track.time.total - song.time.total;

                    return (time >= -15 && time <= 15 || time === 0) && title.length > 0;
                })?.at(0);

                // Если отфильтровать треки не удалось
                if (!findTrack) {
                    Logger.log("ERROR", `[APIs/${platform.name}/fetch] The tracks found do not match the description of this`);
                    lastError = Error(`[APIs/${platform.name}] The tracks found do not match the description of this`);
                    continue;
                }

                // Получение исходника
                const song = await platformAPI.request<"track">(findTrack["url"]).request();

                // Если при получении трека произошла ошибка
                if (song instanceof Error) {
                    Logger.log("ERROR", song);
                    lastError = song;
                    continue;
                }

                // Если есть ссылка на аудио
                if (song !== undefined) {
                    // Меняем время трека на время найденного трека
                    track["_duration"] = song.time;

                    // Выносим ссылку из цикла
                    link = song.link;
                    break;
                }
            }

            // Если нет ссылки на исходный аудио файл
            if (!link) {
                // Если во время поиска произошла ошибка
                if (lastError) return lastError;

                // Если нет ошибки и ссылки
                else if (!lastError) return Error(`[APIs/fetch] There were no errors and there are no audio links to the resource`);

                // Если нет ссылки
                return Error(`[APIs/fetch] Unable to get audio link on alternative platforms!`);
            }

            return link;
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @public
     */
    public request = (name: RestServerSide.API["name"]): RestClientSide.Request => {
        const platform = this.platform(name);
        return platform ? new RestClientSide.Request(platform) : null;
    };

    /**
     * @description Получаем платформу
     * @param name - Имя платформы
     * @private
     */
    private platform = (name: RestServerSide.API["name"]) => {
        const platform = this.platforms.supported[name];

        // Если есть такая платформа по имени
        if (platform) return platform;

        return this.allow.find((api) => api.name === name);
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @protected
     * @readonly
     */
    protected request_worker<T extends keyof APIRequests>({platform, payload, options}: RestClientSide.ClientOptions): Promise<APIRequests[T] | Error> {
        return new Promise((resolve) => {
            const requestId = this.generateUniqueId(); // Генерируем номер запроса

            // Отправляем запрос
            this.worker.postMessage({ platform: platform.name, payload, options, requestId });

            // Слушаем сообщение или же ответ
            const onMessage = (message: RestServerSide.Result<T> & { requestId?: string }) => {
                if (message.requestId !== requestId) return; // Не наш ответ — игнорируем

                this.worker.off("message", onMessage); // Отписываемся после получения

                const { result, status } = message;
                const baseAPI: RestServerSide.APIBase = {
                    name: platform.name,
                    url: platform.url,
                    color: platform.color
                };

                // Если получена ошибка
                if (result instanceof Error) return resolve(result);

                // Если получен успешный ответ
                else if (status === "success") {
                    if (Array.isArray(result)) return resolve(result.map(item => new Track(item, baseAPI)) as APIRequests[T]);

                    else if (typeof result === "object" && "items" in result) {
                        return resolve({
                            ...result,
                            items: result.items.map(item => new Track(item, baseAPI)),
                        } as any);
                    }

                    return resolve(new Track(result, baseAPI) as APIRequests[T]);
                }

                resolve(null);
            };

            // Слушаем worker
            this.worker.on("message", onMessage);
        });
    };
}



/**
 * @description Названия всех доступных платформ
 * @type APIs_names
 */
type APIs_names = 'YOUTUBE' | 'SPOTIFY' | 'VK' | 'YANDEX' | 'SOUNDCLOUD' | "DEEZER";

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequests
 * @helper
 */
type APIRequests = {
    track: Track
    playlist: Track.list
    album: Track[]
    artist: Track[]
    wave: Track.list
    search: Track[]
}

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequestsRaw
 * @helper
 */
type APIRequestsRaw = {
    track: TrackRaw.Data
    playlist: TrackRaw.List
    album: TrackRaw.List
    artist: TrackRaw.Data[]
    wave: TrackRaw.List
    search: TrackRaw.Data[]
}

/**
 * @description Тип параметров для каждого запроса
 * @type ExecuteParams
 * @helper
 */
type ExecuteParams<T extends keyof APIRequests = keyof APIRequests> =
    T extends "track" ? { audio: boolean } :
        T extends "playlist" | "album" | "artist" | "wave" | "search" ? { limit: number } :
                never;

/**
 * @description Сырые типы данных для дальнейшего использования
 * @namespace TrackRaw
 * @helper
 */
namespace TrackRaw {
    export interface Data {
        readonly id: string
        title: string
        readonly url: string
        artist: { title: string; readonly url: string; image?: { url: string } }
        image: { url: string }
        time: { total: string; split?: string }
        audio?: string
    }

    export interface List {
        readonly url: string
        readonly title: string
        items: Data[]
        image: { url: string }
        artist?: { title: string; readonly url: string; image?: { url: string } }
    }
}

/** ================= Client-Side ================= */
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
            return this._api.auth
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
        public request<T extends keyof APIRequests>(payload: string, options?: {audio: boolean}) {
            const matchedRequest = this._api.requests.find((item) => {
                if (item.name === payload) return true;
                if (typeof payload === "string" && payload.startsWith("http")) {
                    return item["filter"]?.test(payload) ?? false;
                }
                return false;
            }) || this._api.requests.find(item => item.name === "search");

            return {
                // Получение типа запроса
                type: matchedRequest?.name as T,

                // Функция запроса на Worker для получения данных
                request: () => db.api["request_worker"]<T>(
                    {
                        platform: this._api,
                        payload: payload,
                        requestId: null, // Присваивается в request_worker
                        options,
                    }
                )
            }
        };
    }
}

/** ================= Worker-Side ================= */
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
     */
    export type APIs = Record<API['name'], API>

    /**
     * @description Данные для валидного запроса параллельном процессу
     * @interface ServerOptions
     */
    export type ServerOptions = RestClientSide.ClientOptions & {
        platform: APIs_names;
        data?: boolean
    }

    /**
     * @description Передаваемые данные из worker в основной поток
     * @type Result
     * @public
     */
    export type Result<T extends keyof APIRequests = keyof APIRequests> = {
        requestId: string;
        status: "success";
        type: T;
        result: APIRequestsRaw[T];
    } | {
        requestId: string;
        status: "error";
        result: Error;
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface APIBase
     * @public
     */
    export interface APIBase {
        readonly name: APIs_names
        readonly url: string
        readonly color: number
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface API
     * @public
     */
    export interface API extends APIBase {
        readonly audio: boolean;
        readonly auth: boolean;
        readonly filter: RegExp;
        readonly requests: (RequestDef<"track"> | RequestDef<"search"> | RequestDef<"artist"> | RequestDef<"wave"> | RequestDef<"album"> | RequestDef<"playlist">)[];
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
         * @description Платформы без данных для авторизации
         * @protected
         */
        authorization: APIs_names[];

        /**
         * @description Платформы без возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: APIs_names[];

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: APIs_names[]
    }
}