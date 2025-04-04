import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {ClientRequest, IncomingMessage, request as httpRequest} from "node:http";
import {request as httpsRequest, RequestOptions} from "node:https";
import {Track} from "@service/player";
import {env, handler} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class API_requester
 * @public
 */
export class API_requester extends handler<API> {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    public readonly platforms = {
        /**
         * @description Все загруженные платформы
         * @protected
         */
        supported: this.files,

        /**
         * @description Платформы без данных для авторизации
         * @protected
         */
        authorization: [] as API["name"][],

        /**
         * @description Платформы без возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: [] as API["name"][],

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: [] as API["name"][]
    };
    /**
     * @description База с лимитами обрабатываемых данных
     * @protected
     * @readonly
     */
    public readonly limits = {
        /**
         * @description Кол-во получаемых элементов трека при получении плейлиста
         * @protected
         */
        playlist: parseInt(env.get("APIs.limit.playlist")),

        /**
         * @description Кол-во получаемых элементов трека при получении альбома
         * @protected
         */
        album: parseInt(env.get("APIs.limit.album")),

        /**
         * @description Кол-во получаемых элементов трека при поиске
         * @protected
         */
        search: parseInt(env.get("APIs.limit.search")),

        /**
         * @description Кол-во получаемых элементов трека при запросе треков автора
         * @protected
         */
        author: parseInt(env.get("APIs.limit.author"))
    };

    /**
     * @description Исключаем платформы из общего списка
     * @return API.request[]
     * @public
     */
    public get allow() {
        return this.platforms.supported.filter((platform) => platform.name !== "DISCORD" && platform.auth);
    };

    /**
     * @description Загружаем класс вместе с дочерним
     * @public
     */
    public constructor() {
        super("src/handlers/apis");
    };

    /**
     * @description Функция загрузки api запросов
     * @public
     */
    public register = () => {
        this.load();

        // Загружаем команды в текущий класс
        for (let file of this.files) {
            if (!file.auth) db.api.platforms.authorization.push(file.name);
            if (!file.audio) db.api.platforms.audio.push(file.name);
        }
    };

    /**
     * @description Функция для перезагрузки
     * @public
     */
    public preregister = () => {
        this.unload();
        this.register();
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @return APIRequest
     * @public
     */
    public request = (argument: API["name"] | string) => {
        // Ищем платформу
        const api = this.platforms.supported.find((item): boolean => {
            // Если была указана ссылка
            if (argument.startsWith("http")) return !!item.filter.exec(argument) || !!argument.match(item.filter) || item.name === "DISCORD";

            // Если был указан текст
            return item.name.startsWith(argument) || !!item.name.match(argument) || !!item.filter.exec(argument);
        });

        // Создаем класс для выполнения запросов
        return new APIRequest(api);
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     */
    public fetch = (track: Track): Promise<string | Error | null> => {
        return new Promise(async (resolve) => {

            // Если платформа может сама выдавать данные о треке
            if (!this.platforms.authorization.includes(track.api.name) && !this.platforms.audio.includes(track.api.name)) {
                const api = this.request(track.api.name).get("track");

                // Если нет такого запроса
                if (!api) return resolve(Error(`[Song/${track.api.name}]: not found callback for track`));

                // Если исходник уже не актуален, то получаем новый
                try {
                    const song = await api.execute(track.url, {audio: true});

                    // Если не удалось получить новый исходник
                    if (song instanceof Error) return resolve(song);

                    // Выдаем новый исходник
                    return resolve(song.link);
                } catch (err) {
                    return resolve(err as Error);
                }
            }

            // Ищем платформу где будем искать данные трека
            const platform = this.request(this.platforms.supported.find((plt) => plt.requests.length >= 2 && plt.audio).name);

            try {
                // Ищем подходящий трек
                const tracks = await platform.get("search").execute(`${track.artist.title} - ${track.name}`, {limit: 5});
                if (tracks instanceof Error || tracks.length === 0) return resolve(null);

                // Если он был найден, то получаем исходник трека
                const song = await platform.get("track").execute(tracks?.at(0)?.url, {audio: true});
                if (song instanceof Error || !song.link) return resolve(null);

                // Отдаем исходник трека
                return resolve(song.link);
            } catch (err) {
                return resolve(err as Error);
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Получаем ответ от локальной базы APIs
 * @class APIRequest
 * @private
 */
export class APIRequest {
    /**
     * @description Класс который дает доступ к запросам платформы
     * @readonly
     * @private
     */
    private readonly _api: API = null;

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
    public get auth() { return db.api.platforms.authorization.includes(this.platform); };

    /**
     * @description Выдаем int, цвет платформы
     * @return number
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Ищем платформу из доступных
     * @param argument {API.platform} Имя платформы
     * @public
     */
    public constructor(argument: API) {
        this._api = argument;
    };

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {get} Тип запроса
     * @public
     */
    public get<T extends (APIs.track | APIs.playlist | APIs.album | APIs.author | APIs.search)["name"]>(type: T | string) {
        return this._api.requests.find((item)=> {
            // Если указана ссылка
            if (type.startsWith("http")) {
                if (item.name === "search") return null;
                else if (item.name === type || item.filter && !!item.filter.exec(type) || item.filter && !!type.match(item.filter)) return item;
                return null;
            }

            // Скорее всего надо произвести поиск
            else if (item.name === "search" || item.name === type) return item;

            return null;
        }) as T extends "track" ? APIs.track : T extends "album" ? APIs.album : T extends "playlist" ? APIs.playlist : T extends "author" ? APIs.author : APIs.search;
    };
}

/**
 * @author SNIPPIK
 * @description Данные о платформе в ограниченном кол-ве
 * @interface APISmall
 */
export interface APISmall {
    /**
     * @description Имя платформы
     * @readonly
     * @public
     */
    readonly name: "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

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
export interface API {
    /**
     * @description Имя платформы
     * @readonly
     * @public
     */
    readonly name: "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

    /**
     * @description Ссылка для работы фильтра
     * @readonly
     * @public
     */
    readonly url: string;

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
     * @description Цвет платформы
     * @readonly
     * @public
     */
    readonly color: number;

    /**
     * @description Запросы платформы
     * @readonly
     * @public
     */
    readonly requests: (APIs.track | APIs.playlist | APIs.album | APIs.author | APIs.search)[];
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

        // Функция получения данных
        execute: (url: string, options: {audio: boolean}) => Promise<Track | Error>
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

        // Функция получения данных
        execute: (url: string, options: {limit: number}) => Promise<Track.playlist | Error>
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

        // Функция получения данных
        execute: (url: string, options: {limit: number}) => Promise<Track.playlist | Error>
    }

    /**
     * @description Что из себя должен представлять запрос данные треков автора
     * @interface author
     */
    export interface author {
        // Название типа запроса
        name: "author"

        // Фильтр типа запроса
        filter: RegExp;

        // Функция получения данных
        execute: (url: string, options: {limit: number}) => Promise<Track[] | Error>
    }

    /**
     * @description Что из себя должен представлять поиск треков
     * @interface search
     */
    export interface search {
        // Название типа запроса
        name: "search"

        // Функция получения данных
        execute: (text: string, options: {limit: number}) => Promise<Track[] | Error>
    }
}










/**
 * @author SNIPPIK
 * @description Класс создающий запрос
 * @class Request
 * @abstract
 */
abstract class Request {
    /**
     * @description Данные хранимые для произведения запроса
     * @protected
     * @readonly
     */
    protected data: RequestData = { headers: {} };

    /**
     * @description Получаем протокол ссылки
     * @private
     */
    private get protocol(): { (options: (RequestOptions | string | URL), callback?: (res: IncomingMessage) => void): ClientRequest } {
        return this.data.protocol.startsWith("https") ? httpsRequest : httpRequest;
    };

    /**
     * @description Создаем запрос по ссылке, модифицируем по необходимости
     * @public
     */
    public get request(): Promise<IncomingMessage | Error> {
        return new Promise<IncomingMessage | Error>((resolve) => {
            const request = this.protocol(this.data, (res) => {
                // Если надо сделать редирект на другой ресурс
                if ((res.statusCode >= 300 && res.statusCode < 400) && res.headers?.location) {
                    this.data.path = res.headers.location;
                    return resolve(this.request);
                }

                return resolve(res);
            });

            // Если запрос POST, отправляем ответ на сервер
            if (this.data.method === "POST" && this.data.body) request.write(this.data.body);

            /**
             * @description Событие если подключение было сорвано
             */
            request.once("close", () => {
                this.data = null;
                request.removeAllListeners();
                request.destroy();
            });

            request.end();
        });
    };

    /**
     * @description Инициализируем класс
     * @param url - Ссылка
     * @param options - Опции
     * @public
     */
    public constructor(url: string, options?: httpsClient["data"]) {
        // Если ссылка является ссылкой
        if (url.startsWith("http")) {
            const {hostname, pathname, search, port, protocol} = new URL(url);

            // Создаем стандартные настройки
            Object.assign(this.data, {
                port, hostname, path: pathname + search, protocol
            });
        }

        // Если user-agent есть готовый
        if (typeof options?.useragent === "string") {
            Object.assign(this.data.headers, {
                "User-Agent": options.useragent
            });
        }

        // Надо ли генерировать user-agent
        else if (options?.useragent) {
            const OS = [ "X11; Linux x86_64;", "Windows NT 10.0; Win64; x64;" ];
            const platform = OS[(OS.length - 1).random(0)];
            const version = (136).random(120);

            Object.assign(this.data.headers, {
                "User-Agent": `Mozilla/5.0 (${platform} rv:${version}.0) Gecko/20100101 Firefox/${version}.0`,
            });
        }

        Object.assign(this.data, options);
    };
}

/**
 * @author SNIPPIK
 * @description Создаем http или https запрос
 * @class httpsClient
 * @public
 */
export class httpsClient extends Request {
    /**
     * @description Получаем страницу в формате string
     * @public
     */
    public get toString(): Promise<string | Error> {
        let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage, data = "";

        return new Promise<string | Error>(async (resolve) => {
            this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];

                // Делаем выбор расшифровщика UFT-8
                if (encoding === "br") decoder = res.pipe(createBrotliDecompress());
                else if (encoding === "gzip") decoder = res.pipe(createGunzip());
                else if (encoding === "deflate") decoder = res.pipe(createDeflate());
                else decoder = res;

                // Запускаем расшифровку
                decoder.setEncoding("utf-8")
                    .on("data", (chunk) => {
                        data += chunk;
                    })
                    .once("end", () => {
                        return resolve(data);
                    });
            }).catch((err) => {
                return resolve(err);
            });
        });
    };

    /**
     * @description Получаем со страницы JSON (Работает только тогда когда все страница JSON)
     * @public
     */
    public get toJson(): Promise<json | Error> {
        return this.toString.then(async (body) => {
            if (body instanceof Error) return body;

            try {
                return JSON.parse(body);
            } catch {
                return Error(`Invalid json response body at ${this.data.hostname}`);
            }
        });
    };

    /**
     * @description Берем данные из XML страницы
     * @public
     */
    public get toXML(): Promise<Error | string[]> {
        return new Promise(async (resolve) => {
            const body = await this.toString;

            // Если была получена ошибка
            if (body instanceof Error) return resolve(Error("Not found XML data!"));

            // Ищем данные в XML странице для дальнейшего вывода
            const items = body.match(/<[^<>]+>([^<>]+)<\/[^<>]+>/g);
            const filtered = items.map((tag) => tag.replace(/<\/?[^<>]+>/g, ""));
            return resolve(filtered.filter((text) => text.trim() !== ""));
        });
    };

    /**
     * @description Проверяем ссылку на работоспособность
     * @public
     */
    public get status(): Promise<boolean> {
        return this.request.then(async (resource) => {
            if (resource instanceof Error) return false;
            return resource?.statusCode && resource.statusCode >= 200 && resource.statusCode <= 400;
        });
    };
}

/**
 * @author SNIPPIK
 * @description Данные для произведения запроса
 * @interface RequestData
 * @private
 */
interface RequestData extends RequestOptions {
    // Метод запроса
    method?: "POST" | "GET" | "HEAD" | "PATCH";

    // Headers запроса
    headers?: RequestOptions["headers"];

    // Если мы хотим что-то отправить серверу
    body?: string;

    // Добавлять user-agent, рандомный или указанный
    useragent?: boolean | string;
}