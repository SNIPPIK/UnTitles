import {Track} from "@service/player";
import {handler} from "@handler";
import {env} from "@app/env";
import {db} from "@app/db";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class RestObject
 * @public
 */
export class RestObject extends handler<RestAPI> {
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
        authorization: [] as RestAPI["name"][],

        /**
         * @description Платформы без возможности получить аудио
         * @warn По-умолчанию запрос идет к track
         * @protected
         */
        audio: [] as RestAPI["name"][],

        /**
         * @description Заблокированные платформы
         * @protected
         */
        block: [] as RestAPI["name"][]
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
        super("src/handlers/rest/apis");
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
    public request(name: RestAPI["name"]): RestRequest | null {
        const platform = this.files.find(file => file.name === name);
        return platform ? new RestRequest(platform) : null;
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     */
    public fetch = async (track: Track): Promise<string | Error | null> => {
        try {
            // Проверяем, если платформа может сама выдавать данные о треке
            if (!this.platforms.authorization.includes(track.api.name) && !this.platforms.audio.includes(track.api.name)) {
                const api = this.request(track.api.name).get("track");

                if (!api) return Error(`[Song/${track.api.name}]: not found callback for track`);

                const song = await api.execute(track.url, { audio: true });
                if (song instanceof Error) return song;

                return song.link;
            }

            // Ищем платформу с поддержкой аудио и запросов
            const platform = this.request(this.platforms.supported.find(plt => plt.requests.length >= 2 && plt.audio).name);

            // Ищем трек по имени артиста и названия
            const tracks = await platform.get("search").execute(`${track.artist.title} - ${track.name}`, { limit: 5 });
            if (tracks instanceof Error) return tracks;
            else if (tracks.length === 0) return new Error(`Fail searching tracks`);

            // Получаем исходник трека
            const song = await platform.get("track").execute(tracks[0]?.url, { audio: true });
            if (song instanceof Error) return song;
            else if (!song.link) return Error("Fail getting link")

            return song.link;
        } catch (err) {
            return err instanceof Error ? err : new Error("Unknown error occurred");
        }
    };
}

/**
 * @author SNIPPIK
 * @description Получаем ответ от локальной базы APIs
 * @class RestRequest
 * @private
 */
export class RestRequest {
    /**
     * @description Класс который дает доступ к запросам платформы
     * @readonly
     * @private
     */
    private readonly _api: RestAPI = null;

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
     * @description Выдаем bool, есть ли доступ к получению аудио у платформы
     * @return boolean
     * @public
     */
    public get audio() { return db.api.platforms.audio.includes(this.platform); };

    /**
     * @description Выдаем int, цвет платформы
     * @return number
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Ищем платформу из доступных
     * @param argument {RestAPI.platform} Имя платформы
     * @public
     */
    public constructor(argument: RestAPI) {
        this._api = argument;
    };

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {get} Тип запроса
     * @public
     */
    public get<T extends (RestAPIs.track | RestAPIs.playlist | RestAPIs.album | RestAPIs.author | RestAPIs.search)["name"]>(type: T | string) {
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
        }) as T extends "track" ? RestAPIs.track : T extends "album" ? RestAPIs.album : T extends "playlist" ? RestAPIs.playlist : T extends "author" ? RestAPIs.author : RestAPIs.search;
    };
}

/**
 * @author SNIPPIK
 * @description Создаем класс для итоговой платформы для взаимодействия с APIs
 * @interface RestAPIBase
 * @public
 */
export interface RestAPIBase {
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
 * @interface RestAPI
 * @public
 */
export interface RestAPI extends RestAPIBase {
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
    readonly requests: (RestAPIs.track | RestAPIs.playlist | RestAPIs.album | RestAPIs.author | RestAPIs.search)[];
}

/**
 * @author SNIPPIK
 * @description Доступные запросы для платформ
 * @namespace RestAPIs
 * @public
 */
export namespace RestAPIs {
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
        execute: (url: string, options: {audio: boolean}) => Promise<Track | Error>;
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
        execute: (url: string, options: {limit: number}) => Promise<Track.list | Error>;
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
        execute: (url: string, options: {limit: number}) => Promise<Track.list | Error>;
    }

    /**
     * @description Что из себя должен представлять запрос данные треков автора
     * @interface author
     */
    export interface author {
        // Название типа запроса
        name: "author";

        // Фильтр типа запроса
        filter: RegExp;

        // Функция получения данных
        execute: (url: string, options: {limit: number}) => Promise<Track[] | Error>;
    }

    /**
     * @description Что из себя должен представлять поиск треков
     * @interface search
     */
    export interface search {
        // Название типа запроса
        name: "search";

        // Функция получения данных
        execute: (text: string, options: {limit: number}) => Promise<Track[] | Error>;
    }
}