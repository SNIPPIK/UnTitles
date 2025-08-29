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
     * @description Получаем список всех доступных платформ
     * @private
     */
    private get array(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array;
    };

    /**
     * @description Платформы с доступом к запросам
     * @returns RestServerSide.API[]
     * @public
     */
    public get allow(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null);
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get audioSupport(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null && api.audio !== false && !this.platforms.block.includes(api.name));
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
                    this.platforms = data;
                    return resolve(true);
                }
            });

            // Если возникнет ошибка, пересоздадим worker
            worker.once("error", (error) => {
                console.log(error);
                return this.startWorker();
            });
        });
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
     * @description Ищем похожий трек, но на других платформах
     * @param track - Трек который надо найти
     * @param array - Список платформ для поиска
     * @returns Promise<Track | Error>
     * @private
     */
    private fetch = async (track: Track, array: RestServerSide.API[]): Promise<Track | Error> => {
        const { name, artist } = track;

        // Оригинальный трек по словам
        const original = name.toLowerCase().replace(/[^\w\s:;]|_/gi, "").replace(/\s+/gi, " ").split(" ");
        let link: Track = null, lastError: Error;

        // Ищем нужную платформу
        for (const platform of array) {
            // Получаем класс для работы с Worker
            const platformAPI = this.request(platform.name);

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
                Logger.log("ERROR", `[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                lastError = Error(`[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                continue;
            }

            // Ищем нужный трек
            // Можно разбить проверку на слова, сравнивать кол-во совпадений, если больше половины то точно подходит
            const findTrack = search.find((song) => {
                const candidate = song.name.toLowerCase().replace(/[^\w\s:;]|_/gi, "").replace(/\s+/gi, " ").split(" ");
                const Matches = candidate.map((x) => original.includes(x));
                const time = Math.abs(track.time.total - song.time.total);

                return (time <= 10 || time === 0) && Matches.length / Math.max(original.length, candidate.length);
            });

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
            if (song.link) {
                // Меняем время трека на время найденного трека
                track["_duration"] = song.time;

                // Выносим ссылку из цикла
                link = song;
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
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @returns Promise<string | Error>
     * @public
     */
    public fetchAudioLink = async (track: Track): Promise<string | Error> => {
        const { url, api } = track;
        const { authorization, audio } = this.platforms;

        try {
            // Если платформа поддерживает получение аудио и может получать данные
            if (authorization.includes(api.name) && audio.includes(api.name)) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();

                // Если получили ошибку
                if (song instanceof Error) return null;

                track["_duration"] = song.time;
                return song.link;
            }

            const song = await this.fetch(track, this.audioSupport);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return song.link;
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Если надо найти похожий трек/и на другой платформе
     * @param track - Трек для которого надо найти похожий
     * @returns Promise<Track[] | Error>
     * @public
     */
    public fetchRelatedTracks = async (track: Track): Promise<Track[] | Error> => {
        const { url, api, name, artist } = track;
        const { related } = this.platforms;

        try {
            // Если платформа умеет сама выдавать похожие треки
            if (related.includes(api.name)) {
                const item = await this.request(api.name).request<"related">(`${url}&list=RD`, {audio: true}).request();

                // Если не нашлись похожие треки, то делаем поиск
                if (!item?.["items"] || item instanceof Error) {
                    const items = await this.request(api.name).request<"search">(`${name} ${artist.title}`).request();

                    // Если получили ошибку
                    if (items instanceof Error) {
                        Logger.log("ERROR", items);
                        return null;
                    }

                    // Ищем оригинальный трек
                    const org = items.find((trk) => trk.name === name);

                    // Если есть оригинальный трек
                    if (org) items.splice(items.indexOf(org), 1);

                    return items;
                }

                // Отдаем найденные треки
                return item.items;
            }

            const song = await this.fetch(track, this.allowRelated);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return this.fetchRelatedTracks(song);
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Создание класса для взаимодействия с платформой, рекомендуются добавлять timeout из-вне
     * @protected
     * @readonly
     */
    protected request_worker<T extends keyof APIRequests>({platform, payload, options}: RestClientSide.ClientOptions): Promise<APIRequests[T] | Error> {
        return new Promise((resolve) => {
            const requestId = this.generateUniqueId(); // Генерируем номер запроса

            // Слушаем сообщение или же ответ
            const onMessage = (message: RestServerSide.Result<T> & { requestId?: string }) => {
                // Не наш ответ — игнорируем
                if (message.requestId !== requestId) return;

                // Отписываемся после получения
                this.worker.off("message", onMessage);

                const { result, status } = message;
                const baseAPI: RestServerSide.APIBase = {
                    name: platform.name,
                    url: platform.url,
                    color: platform.color
                };

                // Если получена ошибка
                if (result instanceof Error) {
                    // Если платформа не отвечает, то отключаем ее!
                    if (/Connection Timeout/.test(result.message)) {
                        this.platforms.block.push(platform.name);
                    }

                    return result;
                }

                // Если получен успешный ответ
                else if (status === "success") {
                    const parseTrack = (item: TrackRaw.Data) => new Track(item, baseAPI);

                    // Если пришел список треков
                    if (Array.isArray(result)) {
                        return resolve(result.map(parseTrack) as APIRequests[T]);
                    }

                    // Если пришел плейлист
                    else if (typeof result === "object" && "items" in result) {
                        return resolve({ ...result, items: result.items.map(parseTrack) } as any);
                    }

                    // Если просто трек
                    return resolve(parseTrack(result) as APIRequests[T]);
                }

                resolve(null);
            };

            // Слушаем worker
            this.worker.on("message", onMessage);

            // Отправляем запрос
            this.worker.postMessage({ platform: platform.name, payload, options, requestId });
        });
    };
}


/** ================= Decorators ================= */
/**
 * @author SNIPPIK
 * @description Параметры запроса
 */
interface RestOptions {
    readonly name: APIs_names;
    readonly url: string;
    readonly color: number;
    readonly audio: boolean;
    readonly auth?: string;
    readonly filter: RegExp;
}

/**
 * @author SNIPPIK
 * @description Декоратор создающий заголовок запроса
 * @decorator
 */
export function DeclareRest(options: RestOptions) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            name = options.name;
            url = options.url;
            color = options.color;
            audio = options.audio;
            auth = options.auth;
            filter = options.filter;
        }
}

/**
 * @author SNIPPIK
 * @description Дополнительные параметры
 * @decorator
 */
export function OptionsRest<T>(options: T) {
    // Загружаем данные в класс
    return <T extends { new (...args: any[]): object }>(target: T) =>
        class extends target {
            options = options;
        }
}
/** ================= Decorators ================= */


/**
 * @description Названия всех доступных платформ
 * @type APIs_names
 */
type APIs_names = "YOUTUBE" | "SPOTIFY" | "VK" | "YANDEX" | "SOUNDCLOUD" | "DEEZER";

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
    related: Track.list
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
    related: TrackRaw.List
    search: TrackRaw.Data[]
}

/**
 * @description Тип параметров для каждого запроса
 * @type ExecuteParams
 * @helper
 */
type ExecuteParams<T extends keyof APIRequests = keyof APIRequests> = T extends "track" ? { audio: boolean } : T extends "playlist" | "album" | "artist" | "related" | "search" ? { limit: number } : never;

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
        /**
         * @description Название платформы
         */
        readonly name: APIs_names;

        /**
         * @description Ссылка на платформу
         */
        readonly url: string;

        /**
         * @description Цвет платформы, в стиле discord
         */
        readonly color: number;
    }

    /**
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @class API
     * @public
     */
    export class API implements APIBase {
        /**
         * @description Название платформы
         */
        readonly name: APIs_names;

        /**
         * @description Ссылка на платформу
         */
        readonly url: string;

        /**
         * @description Цвет платформы, в стиле discord
         */
        readonly color: number;

        /**
         * @description Может ли платформа получать аудио сама. Аудио получается через запрос к track
         */
        readonly audio: boolean;

        /**
         * @description Если ли данные для авторизации
         * @default undefined - данные не требуются
         */
        readonly auth?: string;

        /**
         * @description Regexp для поиска платформы
         */
        readonly filter: RegExp;

        /**
         * @description Запросы к данных платформы
         */
        readonly requests: (RequestDef<"track"> | RequestDef<"search"> | RequestDef<"artist"> | RequestDef<"related"> | RequestDef<"album"> | RequestDef<"playlist">)[];

        /**
         * @description Доп параметры
         */
        readonly options: any;
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
         * @description Платформы с данных для авторизации
         * @protected
         */
        authorization: APIs_names[];

        /**
         * @description Платформы с возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: APIs_names[];

        /**
         * @description Платформы с возможностью получать похожие треки
         * @protected
         */
        related: APIs_names[];

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: APIs_names[];
    }
}