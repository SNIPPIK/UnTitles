import {BrotliDecompress, createBrotliDecompress, createDeflate, createGunzip, Deflate, Gunzip} from "node:zlib";
import {ClientRequest, IncomingMessage, request as httpRequest} from "node:http";
import {MessageEvent as WebSocketEvent, WebSocket as WS, CloseEvent} from "ws";
import {request as httpsRequest, RequestOptions} from "node:https";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {Track} from "@service/player";
import {env, handler} from "@handler";
import {TypedEmitter} from "@utils";
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
            return item.name.startsWith(argument) || !!item.name.match(argument) || !!item.filter.test(argument) || item.name === "YOUTUBE";
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
            if (!this.platforms.authorization.includes(track.platform) && !this.platforms.audio.includes(track.platform)) {
                const api = this.request(track.platform).get("track");

                // Если нет такого запроса
                if (!api) return resolve(Error(`[Song/${track.platform}]: not found callback for track`));

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
                const tracks = await platform.get("search").execute(`${track.artist.title} - ${track.title}`, {limit: 5});
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
    protected readonly data: RequestData = { headers: {} };

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
        return new Promise((resolve) => {
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
             * @public
             */
            request.once("close", () => {
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
            const OS = [ "(X11; Linux x86_64)", "(Windows NT 10.0; Win64; x64)" ];
            const version = `${(128).random(96)}.0.${(6250).random(1280)}.${(250).random(59)}`;

            Object.assign(this.data.headers, {
                "User-Agent": `Mozilla/5.0 ${OS[(OS.length - 1).random(0)]} AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${version} Safari/537.36`,
                "Sec-Ch-Ua-Full-Version": version,
                "Sec-Ch-Ua-Bitness": `64`,
                "Sec-Ch-Ua-Arch": "x86",
                "Sec-Ch-Ua-Mobile": "?0"
            });
        }

        Object.assign(this.data, options);
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
        return new Promise<string | Error>((resolve) => {
            this.request.then((res) => {
                if (res instanceof Error) return resolve(res);

                const encoding = res.headers["content-encoding"];
                let decoder: BrotliDecompress | Gunzip | Deflate | IncomingMessage = res, data = "";

                // Делаем выбор расшифровщика UFT-8
                if (encoding === "br") decoder = res.pipe(createBrotliDecompress());
                else if (encoding === "gzip") decoder = res.pipe(createGunzip());
                else if (encoding === "deflate") decoder = res.pipe(createDeflate());

                // Запускаем расшифровку
                decoder.setEncoding("utf-8")
                    .on("data", (c) => data += c)
                    .once("end", () => {
                        setImmediate(() => { data = null });
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
        return this.toString.then((body) => {
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
    public get status(): Promise<boolean> | false {
        return this.request.then((resource) => {
            if (resource instanceof Error) return false;
            return resource?.statusCode && resource.statusCode >= 200 && resource.statusCode <= 400;
        });
    };
}

/**
 * @author SNIPPIK
 * @description WebSocket для взаимодействия с discord, node.js не предоставляет свой
 * @class WebSocket
 * @public
 */
export class WebSocket extends TypedEmitter<WebSocketEvents> {
    /**
     * @description Класс сокета для подключения к серверам discord
     * @readonly
     * @private
     */
    private readonly socket: WS = null;

    /**
     * @description Данные для проверки жизни
     * @readonly
     * @private
     */
    private readonly KeepAlive = {
        interval: null, miss: 0, send: 0
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     * @public
     */
    public set keepAlive(ms: number) {
        if (this.KeepAlive.interval !== undefined) clearInterval(this.KeepAlive.interval);

        // Если есть время для проверки жизни
        if (ms > 0) this.KeepAlive.interval = setInterval(() => {
            if (this.KeepAlive.send !== 0 && this.KeepAlive.miss >= 3) {
                // Пропущено слишком - отключаемся
                this.socket.close();
                this.keepAlive = -1;
            }

            // Задаем время и прочие параметры для правильной работы
            this.KeepAlive.send = Date.now();
            this.KeepAlive.miss++;

            // Отправляем пакет
            this.packet = {
                op: VoiceOpcodes.Heartbeat,
                d: this.KeepAlive.send
            };
        }, ms);
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public set packet(packet: string | object) {
        try {
            this.socket.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Создаем WebSocket для передачи голосовых пакетов
     * @param address - Адрес сервера для соединения
     * @public
     */
    public constructor(address: string) {
        super();
        const Socket = new WS(address);

        Socket.onmessage = this.onmessage;
        Socket.onopen = (event) => this.emit("open", event as any);
        Socket.onclose = (event) => this.emit("close", event as any);
        Socket.onerror = (event) => this.emit("error", event as any);

        // Задаем сокет в класс
        this.socket = Socket;
    };

    /**
     * @description Используется для перехвата сообщения от сервера
     * @param event - Данные для перехвата
     * @readonly
     * @private
     */
    private readonly onmessage = (event: WebSocketEvent) => {
        if (typeof event.data !== "string") return;

        let packet: any;
        try {
            packet = JSON.parse(event.data);
        } catch (error) {
            this.emit("error", error as Error);
        }

        // Если надо обновить интервал жизни
        if (packet.op === VoiceOpcodes.HeartbeatAck) this.KeepAlive.miss = 0;

        this.emit("packet", packet);
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code?: number): void => {
        try {
            this.keepAlive = -1;
            this.socket.close(code);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };
}

/**
 * @description События для VoiceWebSocket
 * @interface WebSocketEvents
 * @class VoiceWebSocket
 */
interface WebSocketEvents {
    "error": (error: Error) => void;
    "open": (event: Event) => void;
    "close": (event: CloseEvent) => void;
    "packet": (packet: any) => void;
}