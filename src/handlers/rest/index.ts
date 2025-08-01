import { Worker } from "node:worker_threads";
import { Logger } from "#structures";
import { Track } from "#core/queue";
import path from "node:path";
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
        if (!this.platforms.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth);
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get audioSupport(): RestServerSide.API[] {
        if (!this.platforms.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth !== false && api.audio !== false && !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к потоку
     * @returns RestServerSide.API[]
     * @public
     */
    public get allowWave(): RestServerSide.API[] {
        if (!this.platforms.array) this.platforms.array = Object.values(this.platforms.supported);
        return this.platforms.array.filter(api => api.auth && api.requests.some((apis) => apis.name === "wave"));
    };

    /**
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public startWorker = async (): Promise<boolean> => {
        // Если уже есть worker
        if (this.worker) {
            this.worker.removeAllListeners();
            await this.worker.terminate();
            this.worker = null;
        }

        // Создаем Worker (распараллеливание запросов Rest/API)
        this.worker = new Worker(path.resolve("src/workers/RestAPIServerThread"), {
            execArgv: ["-r", "tsconfig-paths/register"],
            workerData: { rest: true }
        });

        // Если возникнет ошибка, пересоздадим worker
        this.worker.once("error", (err) => {
            this.worker.removeAllListeners();
            this.worker = null;

            console.log(err);
            return this.startWorker();
        });

        return new Promise(resolve => {
            // Если нет данных о платформах
            if (this.platforms) return resolve(true);

            // Получаем данные о загруженных платформах
            this.worker.postMessage({data: true});
            this.worker.once("message", (data: RestServerSide.Data) => {
                this.platforms = {
                    ...data,
                    supported: Object.fromEntries(data.supported as any) as any
                };

                return resolve(true);
            });
        });
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @returns Promise<string | Error>
     * @public
     */
    public fetch = async (track: Track): Promise<string | Error | null> => {
        try {
            const { name, artist, url, api } = track;
            const { authorization, audio } = this.platforms;

            // Если платформа поддерживает получение аудио и может получать данные
            if (!authorization.includes(api.name) && !audio.includes(api.name)) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();
                return song instanceof Error ? song : song.link;
            }

            let link: string = null, lastError: Error;

            // Оригинальный трек по словам
            const original = track.name.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").trim().split(" ");

            // Ищем нужную платформу
            for (const platform of this.audioSupport) {
                // Получаем класс для работы с Worker
                const platformAPI = this.request(platform.name);

                // Если нет такой платформы
                if (!platformAPI) continue;

                // Поиск трека
                const search = await platformAPI.request<"search">(`${name} ${artist.title}`).request();

                // Если при получении треков произошла ошибка
                if (search instanceof Error) {
                    Logger.log("DEBUG", `${search}`);
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
                    const title = song.name.toLowerCase().replace(/[^\w\s]|_/g, "").replace(/\s+/g, " ").split(" ")
                        .map((x) => original.includes(x));
                    const time = track.time.total - song.time.total;

                    return (time >= -15 && time <= 15 || time === 0) && title.length > 0;
                })?.at(0);

                // Если отфильтровать треки не удалось
                if (!findTrack) {
                    Logger.log("DEBUG", `[APIs/${platform.name}/fetch] The tracks found do not match the description of this`);
                    lastError = Error(`[APIs/${platform.name}] The tracks found do not match the description of this`);
                    continue;
                }

                // Получение исходника
                const song = await platformAPI.request<"track">(findTrack["url"], { audio: true }).request();

                // Если при получении трека произошла ошибка
                if (song instanceof Error) {
                    Logger.log("DEBUG", `${song}`);
                    lastError = song;
                    continue;
                }

                // Если есть ссылка на аудио
                if (song !== undefined) {
                    try {
                        // Меняем время трека на время найденного трека
                        track.time = song.time;
                    } catch {}

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
            Logger.log("DEBUG", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @public
     */
    public request = (name: RestServerSide.API["name"]): RestClientSide.Request | null => {
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
    protected readonly request_worker = ({platform, payload, options}: RestClientSide.ClientOptions): Promise<Track | Track[] | Track.list | Error> => {
        return new Promise((resolve) => {
            // Передает данные запроса в другой поток
            this.worker.postMessage({ platform: platform.name, payload, options });

            // Ждем ответ от потока
            this.worker.once("message", (message: RestServerSide.Result) => {
                const { result, status } = message;
                const baseAPI: RestServerSide.APIBase = {
                    name: platform.name,
                    url: platform.url,
                    color: platform.color
                };

                // Если в результате ошибка
                if (result instanceof Error) return resolve(result);

                // Если статус удачный
                else if (status === "success") {

                    // Если получен список
                    if (Array.isArray(result)) {
                        return resolve(result.map((item) => new Track(item, baseAPI)));
                    }

                    // Если получен плейлист или альбом
                    else if (typeof result === "object" && "items" in result) {
                        return resolve({
                            ...result,
                            items: result.items.map((item) => new Track(item, baseAPI)),
                        });
                    }

                    // Если получен 1 объект
                    return resolve(new Track(result, baseAPI));
                }

                // Если что-то не так
                return null;
            });
        });
    };
}

/**
 * @author SNIPPIK
 * @description Данные для работы в основной системе бота
 * @namespace RestClientSide
 * @public
 */
export namespace RestClientSide {
    /**
     * @author SNIPPIK
     * @description Данные для валидного запроса параллельному процессу
     * @interface ServerOptions
     */
    export interface ClientOptions {
        platform: RestServerSide.API;
        payload: string;
        options?: {
            audio: boolean
        };
    }

    /**
     * @description Авто тип, на полученные данные
     * @type ResultData
     */
    export type ResultData<T> = T extends "track" ? Track | Error : T extends "album" | "playlist" ? Track.list | Error : Track[] | Error;

    /**
     * @description Авто тип, на полученные типы данных
     * @type ResultType
     */
    export type ResultType<T> = T extends "track" ? "track" : T extends "album" ? "album" : T extends "playlist" ? "playlist" : T extends "artist" ? "artist" : T extends "wave" ? "wave" : "search";

    /**
     * @author SNIPPIK
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
        public constructor(private readonly _api: RestServerSide.API) {};

        /**
         * @description Запрос в систему Rest/API, через систему worker
         * @param payload - Данные для отправки
         * @param options - Параметры для отправки
         */
        public request<T extends (RestServerSide.APIs.track | RestServerSide.APIs.playlist | RestServerSide.APIs.album | RestServerSide.APIs.artist | RestServerSide.APIs.search | RestServerSide.APIs.wave)["name"]>(payload: string, options?: {audio: boolean}) {
            return {
                // Получение типа запроса
                type: this._api.requests.find((item) => {
                    // Если производится прямой запрос по названию
                    if (item.name === payload) return item;

                    // Если указана ссылка
                    else if (typeof payload === "string" && payload.startsWith("http")) {
                        if (item.name === "track" && item.filter?.test(payload)) return item;
                    }

                    // Скорее всего надо произвести поиск
                    return item.name === "search";
                })?.name as RestClientSide.ResultType<T>,

                // Функция запроса на Worker для получения данных
                request: () => db.api["request_worker"](
                    {
                        platform: this._api,
                        payload: payload as any,
                        options
                    }
                ) as Promise<RestClientSide.ResultData<T>>
            }
        };
    }
}

/**
 * @author SNIPPIK
 * @description Данные для работы серверной части (Worker)
 * @namespace RestServerSide
 * @public
 */
export namespace RestServerSide {
    /**
     * @description Передаваемые данные из worker в основной поток
     * @type Result
     * @public
     */
    export type Result =
        | {
        status: "success";
        type: "track";
        result: Track.data | Error;
    }
        | {
        status: "success";
        type: "album" | "playlist";
        result: Track.list | Error;
    }
        | {
        status: "success";
        type: "artist" | "search" | "wave";
        result: Track.data[] | Error;
    }

    /**
     * @author SNIPPIK
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface APIBase
     * @public
     */
    export interface APIBase {
        /**
         * @description Имя платформы
         * @readonly
         * @public
         */
        readonly name: "YOUTUBE" | "SPOTIFY" | "VK" | "YANDEX" | "SOUNDCLOUD";

        /**
         * @description Ссылка для работы фильтра
         * @readonly
         * @public
         */
        readonly url: string;

        /**
         * @description Цвет платформы
         * @readonly
         * @public
         */
        readonly color: number;
    }

    /**
     * @author SNIPPIK
     * @description Создаем класс для итоговой платформы для взаимодействия с APIs
     * @interface API
     * @public
     */
    export interface API extends APIBase {
        /**
         * @description Доступ к аудио
         * @readonly
         * @public
         */
        readonly audio: boolean;

        /**
         * @description Доступ с авторизацией
         * @readonly
         * @public
         */
        readonly auth: boolean;

        /**
         * @description Фильтр ссылки для работы определения
         * @readonly
         * @public
         */
        readonly filter: RegExp;

        /**
         * @description Запросы платформы
         * @readonly
         * @public
         */
        readonly requests: (APIs.track | APIs.playlist | APIs.album | APIs.artist | APIs.search | APIs.wave)[];
    }

    /**
     * @author SNIPPIK
     * @description Доступные запросы для платформ
     * @namespace APIs
     * @public
     */
    export namespace APIs {
        /**
         * @description Что из себя должен представлять запрос данные трека
         * @interface track
         */
        export interface track {
            // Название типа запроса
            name: "track";

            // Фильтр типа запроса
            filter: RegExp;

            // Функция получения данных (не доступна в основном потоке)
            execute: (url: string, options: { audio: boolean }) => Promise<Track.data | Error>;
        }

        /**
         * @description Что из себя должен представлять запрос данные плейлиста
         * @interface playlist
         */
        export interface playlist {
            // Название типа запроса
            name: "playlist";

            // Фильтр типа запроса
            filter: RegExp;

            // Функция получения данных (не доступна в основном потоке)
            execute: (url: string, options: { limit: number }) => Promise<Track.list | Error>;
        }

        /**
         * @description Что из себя должен представлять запрос данные альбома
         * @interface album
         */
        export interface album {
            // Название типа запроса
            name: "album";

            // Фильтр типа запроса
            filter: RegExp;

            // Функция получения данных (не доступна в основном потоке)
            execute: (url: string, options: { limit: number }) => Promise<Track.list | Error>;
        }

        /**
         * @description Что из себя должен представлять запрос данные треков автора
         * @interface artist
         */
        export interface artist {
            // Название типа запроса
            name: "artist";

            // Фильтр типа запроса
            filter: RegExp;

            // Функция получения данных (не доступна в основном потоке)
            execute: (url: string, options: { limit: number }) => Promise<Track.data[] | Error>;
        }
        /**
         * @description Что из себя должен представлять поиск треков
         * @interface wave
         */
        export interface wave {
            // Название типа запроса
            name: "wave";

            filter: RegExp;

            // Функция получения данных (не доступна в основном потоке)
            execute: (text: string, options: { limit: number }) => Promise<Track.list | Error>;
        }

        /**
         * @description Что из себя должен представлять поиск треков
         * @interface search
         */
        export interface search {
            // Название типа запроса
            name: "search";

            // Функция получения данных (не доступна в основном потоке)
            execute: (text: string, options: { limit: number }) => Promise<Track.data[] | Error>;
        }
    }

    /**
     * @author SNIPPIK
     * @description Данные для валидного запроса параллельном процессу
     * @interface ServerOptions
     */
    //@ts-ignore
    export interface ServerOptions extends RestClientSide.ClientOptions {
        platform: API["name"];
        // Для получения ответа с найденными платформами
        data?: boolean;
    }

    /**
     * @author SNIPPIK
     * @description Данные класса для работы с Rest/API
     * @interface Data
     * @public
     */
    export interface Data {
        /**
         * @description Все загруженные платформы
         * @protected
         */
        supported: Record<API["name"], API>;

        /**
         * @description Платформы без данных для авторизации
         * @protected
         */
        authorization: API["name"][];

        /**
         * @description Платформы без возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: API["name"][];

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: API["name"][]
    }

    /**
     * @author SNIPPIK
     * @description Все интерфейсы для работы с системой треков
     * @namespace Track
     * @public
     */
    export namespace Track {
        /**
         * @description Данные трека для работы класса
         * @interface data
         */
        export interface data {
            /**
             * @description Уникальный id трека
             * @readonly
             */
            readonly id: string

            /**
             * @description Название трека
             * @readonly
             */
            title: string;

            /**
             * @description Ссылка на трек, именно на трек
             * @readonly
             */
            readonly url: string;

            /**
             * @description Данные об авторе трека
             */
            artist: artist;

            /**
             * @description База с картинками трека и автора
             */
            image: {
                /**
                 * @description Ссылка на картинку трека
                 */
                url: string
            };

            /**
             * @description Данные о времени трека
             */
            time: {
                /**
                 * @description Общее время трека
                 */
                total: string;

                /**
                 * @description Время конвертированное в 00:00
                 */
                split?: string;
            }

            /**
             * @description Данные об исходном файле, он же сам трек
             */
            audio?: string;
        }

        /**
         * @description Пример получаемого плейлиста
         * @interface list
         */
        export interface list {
            /**
             * @description Ссылка на плейлист
             * @readonly
             */
            readonly url: string;

            /**
             * @description Название плейлиста
             * @readonly
             */
            readonly title: string;

            /**
             * @description Что в себе содержит плейлист
             */
            items: Track.data[];

            /**
             * @description Картинка автора плейлиста
             */
            image: {
                /**
                 * @description Ссылка на картинку плейлиста
                 */
                url: string;
            };

            /**
             * @description Данные об авторе плейлиста
             */
            artist?: artist;
        }

        /**
         * @description Данные об авторе трека или плейлиста
         * @interface artist
         */
        export interface artist {
            /**
             * @description Ник/имя автора трека
             * @readonly
             */
            title: string;

            /**
             * @description Ссылка на автора трека
             * @readonly
             */
            readonly url: string;

            /**
             * @description Картинка артиста трека
             */
            image?: {
                /**
                 * @description Ссылка на картинку артиста
                 */
                url: string
            };
        }
    }
}