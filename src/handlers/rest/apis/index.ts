import { Worker } from "node:worker_threads";
import { Track } from "@service/player";
import path from "node:path";
import { db } from "@app/db";

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
    private readonly worker: Worker;

    /**
     * @description База с платформами
     * @public
     */
    public platforms: RestServerSide.Data;

    /**
     * @description Исключаем платформы из общего списка
     * @public
     */
    public get allow() {
        return this.platforms.supported.filter((platform) => platform.auth);
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        this.worker = new Worker(path.resolve("src/services/worker/rest/index.js"), {
            execArgv: ["-r", "tsconfig-paths/register"],
            workerData: null
        });

        // Получаем данные о загруженных платформах
        this.worker.postMessage({data: true});
        this.worker.once("message", (data) => {
            this.platforms = data;
        });

        // Если возникнет ошибка
        this.worker.on("error", (err) => console.log(err));
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @return APIRequest
     * @public
     */
    protected worker_request = (platform: RestServerSide.API["name"], payload: string, options?: {audio: boolean}): Promise<Track | Track[] | Track.list | Error> => {
        const used = this.platforms.supported.find((plt) => plt.name === platform);
        const baseAPI: RestServerSide.APIBase = {
            name: used.name,
            url: used.url,
            color: used.color
        };

        return new Promise((resolve) => {
            const handleMessage = (message: RestServerSide.Result) => {
                // Отключаем эту функцию из-за ненадобности
                this.worker.off('message', handleMessage);

                // Если статус удачный
                if (message.status === "success") {
                    if (message.result instanceof Error) {
                        return resolve(message.result);
                    }

                    switch (message.type) {
                        case "track": {
                            const track = new Track(message.result, baseAPI);
                            return resolve(track);
                        }

                        case "album":
                        case "playlist": {
                            return resolve({
                                ...message.result,
                                items: message.result.items.map((item) => new Track(item, baseAPI)),
                            });
                        }

                        case "artist":
                        case "search": {
                            return resolve(message.result.map((item) => new Track(item, baseAPI)));
                        }
                    }
                }

                else if (message.status === "error") {
                    return resolve(Error(message.result as any));
                }
            };

            // Передает данные запроса
            this.worker.postMessage({ platform, payload, options });

            // Ждем ответ от потока
            this.worker.on('message', handleMessage);
        });
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @return APIRequest
     * @public
     */
    public request(name: RestServerSide.API["name"]): RestClientSide.Request | null {
        const platform = this.platforms.supported.find(file => file.name === name);
        return platform ? new RestClientSide.Request(platform) : null;
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @public
     */
    public fetch = async (track: Track): Promise<string | Error | null> => {
        try {
            // Проверяем, если платформа может сама выдавать данные о треке
            if (!this.platforms.authorization.includes(track.api.name) && !this.platforms.audio.includes(track.api.name)) {
                const api = this.request(track.api.name).request<"track">(track.url, { audio: true });

                const song = await api.request();
                if (song instanceof Error) return song;

                return song.link;
            }

            // Ищем платформу с поддержкой аудио и запросов
            const platform = this.request(this.platforms.supported.find(plt => plt.requests.length >= 2 && plt.audio).name);

            // Ищем трек по имени артиста и названия
            const tracks = await platform.request<"search">(`${track.name} ${track.artist.title}`).request();
            if (tracks instanceof Error) return tracks;
            else if (tracks.length === 0) return new Error(`Fail searching tracks`);

            // Получаем исходник трека
            const song = await platform.request<"track">(tracks[0]?.url).request();
            if (song instanceof Error) return song;
            else if (!song.link) return Error("Fail getting link");

            return song.link;
        } catch (err) {
            return err instanceof Error ? err : new Error("Unknown error occurred");
        }
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
     * @description Авто тип, на полученные данные
     * @type ResultData
     */
    export type ResultData<T> = T extends "track" ? Track | Error : T extends "album" | "playlist" ? Track.list | Error : Track[] | Error;

    /**
     * @description Авто тип, на полученные типы данных
     * @type ResultType
     */
    export type ResultType<T> = T extends "track" ? "track" : T extends "album" ? "album" : T extends "playlist" ? "playlist" : T extends "artist" ? "artist" : "search";

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
        public get platform() { return this._api.name; };

        /**
         * @description Выдаем bool, Недоступна ли платформа
         * @return boolean
         * @public
         */
        public get block() { return db.api.platforms.block.includes(this.platform); };

        /**
         * @description Выдаем bool, есть ли доступ к платформе
         * @return boolean
         * @public
         */
        public get auth() { return this._api.auth };

        /**
         * @description Выдаем bool, есть ли доступ к получению аудио у платформы
         * @return boolean
         * @public
         */
        public get audio() { return this._api.audio; };

        /**
         * @description Выдаем int, цвет платформы
         * @return number
         * @public
         */
        public get color() { return this._api.color; };

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
        public request<T extends (RestServerSide.APIs.track | RestServerSide.APIs.playlist | RestServerSide.APIs.album | RestServerSide.APIs.artist | RestServerSide.APIs.search)["name"]>(payload: string | json, options?: {audio: boolean}) {
            return {
                type: this._api.requests.find((item) => {
                    // Если производится прямой запрос по названию
                    if (item.name === payload) return item;

                    // Если указана ссылка
                    else if (typeof payload === "string" && payload.startsWith("http")) {
                        try {
                            if (item["filter"].exec(payload) || payload.match(item["filter"])) return item;
                        } catch {
                            return null;
                        }
                    }

                    // Если указано что-то другое
                    else if (payload["url"]) return item.name === "track";

                    // Скорее всего надо произвести поиск
                    return item.name === "search";
                }).name as RestClientSide.ResultType<T>,
                request: () => db.api["worker_request"](this.platform, payload as any, options) as Promise<RestClientSide.ResultData<T>>
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
        type: "artist" | "search";
        result: Track.data[] | Error;
    }

    /**
     * @description Авто тип, на полученный тип запроса
     * @type ResultAPIs
     * @public
     */
    export type ResultAPIs<T> = T extends "track" ? APIs.track : T extends "album" ? APIs.album : T extends "playlist" ? APIs.playlist : T extends "author" ? APIs.artist : APIs.search

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
        readonly name: "YOUTUBE" | "SPOTIFY" | "VK" | "YANDEX";

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
        readonly requests: (APIs.track | APIs.playlist | APIs.album | APIs.artist | APIs.search)[];
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
     * @description Данные класса для работы с Rest/API
     * @interface Data
     * @public
     */
    export interface Data {
        /**
         * @description Все загруженные платформы
         * @protected
         */
        supported: API[];

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