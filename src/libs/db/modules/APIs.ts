import {Track} from "@lib/player/track";
import {Handler} from "@lib/handler";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с APIs
 * @class dbl_apis
 * @public
 */
export class dbl_apis {
    /**
     * @description База с платформами
     * @protected
     * @readonly
     */
    protected readonly _platforms = {
        /**
         * @description Поддерживаемые платформы
         * @protected
         */
        supported: [] as Handler.API[],

        /**
         * @description Платформы с отсутствующими данными для авторизации
         * @protected
         */
        authorization: [] as Handler.API["name"][],

        /**
         * @description Платформы с возможностью получить аудио
         * По-умолчанию запрос идет к track
         * @protected
         */
        audio: [] as Handler.API["name"][],

        /**
         * @description Заблокированные платформы, только через owner.list
         * @protected
         */
        block: [] as Handler.API["name"][]
    };
    /**
     * @description База с лимитами обрабатываемых данных
     * @protected
     * @readonly
     */
    protected readonly _limits = {
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
     * @description Получаем лимиты по запросам
     * @return object
     * @public
     */
    public get limits() { return this._limits; };

    /**
     * @description Получаем все данные об платформе
     * @return object
     * @public
     */
    public get platforms() { return this._platforms; };

    /**
     * @description Исключаем платформы из общего списка
     * @return API.request[]
     * @public
     */
    public get allow() {
        return this.platforms.supported.filter((platform) => platform.name !== "DISCORD" && platform.auth);
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @return APIRequest
     * @public
     */
    public request = (argument: Handler.API["name"] | string) => {
        // Ищем платформу
        const api = this.platforms.supported.find((item) => {
            // Если была указана ссылка
            if (argument.startsWith("http")) return !!item.filter.exec(argument) || !!argument.match(item.filter) || item.name === "DISCORD";

            // Если был указан текст
            return item.name === argument || item.name === "YOUTUBE";
        });

        // Создаем класс для выполнения запросов
        return new APIRequest(api);
    };

    /**
     * @description Ищем аудио если платформа может самостоятельно выдать аудио
     * @param track - трек у которого нет аудио
     * @readonly
     * @public
     */
    public readonly fetchAllow = (track: Track): Promise<string | Error> => {
        return new Promise(async (resolve) => {
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
                return resolve(err);
            }
        });
    };

    /**
     * @description Получаем ссылку на трек если прошлая уже не актуальна
     * @param track - трек у которого нет аудио
     * @readonly
     * @public
     */
    public readonly fetch = (track: Track): Promise<string | Error> => {
        return new Promise(async (resolve) => {
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
                return resolve(Error(err));
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
class APIRequest {
    /**
     * @description Класс который дает доступ к запросам платформы
     * @readonly
     * @private
     */
    private readonly _api: Handler.API = null;

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
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {get} Тип запроса
     * @public
     */
    public get<T extends (APIs.track | APIs.playlist | APIs.album | APIs.author | APIs.search)["name"]>(type: T | string) {
        return this._api.requests.find((item) => {
            // Скорее всего надо произвести поиск
            if (item.name === "search" || item.name === type) return item;

            // Если указана ссылка
            if (type.startsWith("http")) {
                if (item.name === type || item.filter && !!item.filter.exec(type) || item.filter && !!type.match(item.filter)) return item;
                return null;
            }
            return null;
        }) as T extends "track" ? APIs.track : T extends "album" ? APIs.album : T extends "playlist" ? APIs.playlist : T extends "author" ? APIs.author : APIs.search;
    };

    /**
     * @description Ищем платформу из доступных
     * @param argument {API.platform} Имя платформы
     * @public
     */
    public constructor(argument: Handler.API) {
        this._api = argument;
    };
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