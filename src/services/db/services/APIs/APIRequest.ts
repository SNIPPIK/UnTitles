import {Track} from "@lib/player";
import {Handler} from "@handler";
import {db} from "@service/db";

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