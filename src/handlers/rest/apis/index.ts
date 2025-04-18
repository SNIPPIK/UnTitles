import {Track} from "@service/player";
import {env, handler} from "@handler";
import {db} from "@app";

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
    public request = (argument: RestAPI["name"] | string) => {
        // Ищем платформу
        const api = this.platforms.supported.find((item) => {
            // Если была указана ссылка
            if (argument.startsWith("http")) return !!item.filter.exec(argument) || !!argument.match(item.filter) || item.name === "DISCORD";

            // Если был указан текст
            return item.name.startsWith(argument) || !!item.name.match(argument) || !!item.filter.exec(argument);
        });

        // Создаем класс для выполнения запросов
        return new RestRequest(api);
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
            // Если указана ссылка
            if (type.startsWith("http")) {
                if (item.name === "search") return null;
                else if (item.name === type || item.filter && !!item.filter.exec(type) || item.filter && !!type.match(item.filter)) return item;
                return null;
            }

            // Скорее всего надо произвести поиск
            else if (item.name === "search" || item.name === type) return item;

            return null;
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