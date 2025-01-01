import {Constructor, Handler} from "@handler";
import {httpsClient} from "@lib/request";
import {Track} from "@lib/player/track";
import {locale} from "@lib/locale";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Constructor.Assign<Handler.API> {
    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        /**
         * @description Ссылки для работы API
         * @protected
         */
        urls: {
            api: "https://api.spotify.com/v1",
            account: "https://accounts.spotify.com/api",
        },

        /**
         * @description Данные для авторизации
         * @protected
         */
        auth: env.check("token.spotify") ? env.get("token.spotify"): null,

        /**
         * @description Токен авторизации
         * @protected
         */
        token: "",

        /**
         * @description Время жизни токена
         * @protected
         */
        time: 0
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({
            name: "SPOTIFY",
            audio: false,
            auth: env.check("token.spotify"),

            color: 1420288,
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi,
            url: "open.spotify.com",

            requests: [
                /**
                 * @description Запрос данных о треке
                 * @type track
                 */
                {
                    name: "track",
                    filter: /track\/[0-9z]+/i,
                    execute: (url: string) => {
                        const ID = /track\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("track\/")?.pop();

                        return new Promise<Track>(async (resolve, reject) => {
                            //Если ID трека не удалось извлечь из ссылки
                            if (!ID) return reject(locale.err("api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(ID);

                            // Если найден трек или похожий объект
                            if (cache) return resolve(cache);

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`tracks/${ID}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return reject(api);
                                const track = sAPI.track(api);

                                db.cache.set(track);

                                return resolve(track);
                            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                        });
                    }
                },

                /**
                 * @description Запрос данных об альбоме
                 * @type album
                 */
                {
                    name: "album",
                    filter: /album\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /album\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("album\/")?.pop();

                        return new Promise<Track.playlist>(async (resolve, reject) => {
                            // Если ID альбома не удалось извлечь из ссылки
                            if (!ID) return reject(locale.err( "api.request.id.album"));

                            try {
                                // Создаем запрос
                                const api: Error | any = await sAPI.API(`albums/${ID}?offset=0&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return reject(api);

                                const tracks = api.tracks.items.map(sAPI.track)

                                return resolve({ url, title: api.name, image: api.images[0], items: tracks, artist: api?.["artists"][0] });
                            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                        });
                    }
                },

                /**
                 * @description Запрос данных об плейлисте
                 * @type playlist
                 */
                {
                    name: "playlist",
                    filter: /playlist\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /playlist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("playlist\/")?.pop();

                        return new Promise<Track.playlist>(async (resolve, reject) => {
                            // Если ID плейлиста не удалось извлечь из ссылки
                            if (!ID) return reject(locale.err( "api.request.id.playlist"));

                            try {
                                // Создаем запрос
                                const api: Error | any = await sAPI.API(`playlists/${ID}?offset=0&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return reject(api);
                                const tracks = api.tracks.items.map(({ track }) => sAPI.track(track));

                                return resolve({ url, title: api.name, image: api.images[0], items: tracks });
                            } catch (e) {
                                return reject(Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных треков артиста
                 * @type author
                 */
                {
                    name: "author",
                    filter: /artist\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /artist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("artist\/")?.pop();

                        return new Promise<Track[]>(async (resolve, reject) => {
                            // Если ID автора не удалось извлечь из ссылки
                            if (!ID) return reject(locale.err( "api.request.id.author"));

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`artists/${ID}/top-tracks?market=ES&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return reject(api);

                                return resolve((api.tracks?.items ?? api.tracks).map(sAPI.track));
                            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                        });
                    }
                },

                /**
                 * @description Запрос данных по поиску
                 * @type search
                 */
                {
                    name: "search",
                    execute: (url, {limit}) => {
                        return new Promise<Track[]>(async (resolve, reject) => {
                            try {
                                // Создаем запрос
                                const api: Error | any = await sAPI.API(`search?q=${url}&type=track&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return reject(api);

                                return resolve(api.tracks.items.map(sAPI.track));
                            } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                        });
                    }
                }
            ]
        });
    };

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method {string} Ссылка api
     */
    protected static API = (method: string): Promise<any | Error> => {
        return new Promise(async (resolve) => {
            try {
                // Нужно обновить токен
                if (!(this.authorization.token !== undefined && this.authorization.time > Date.now() + 2)) {
                    const token = await new httpsClient(`${this.authorization.urls.account}/token`, {
                        headers: {
                            "Accept": "application/json",
                            "Authorization": `Basic ${Buffer.from(this.authorization.auth).toString("base64")}`,
                            "Content-Type": "application/x-www-form-urlencoded",
                            "accept-encoding": "gzip, deflate, br"
                        },
                        body: "grant_type=client_credentials",
                        method: "POST"
                    }).toJson;

                    if (token instanceof Error) return resolve(token);

                    this.authorization.time = Date.now() + token["expires_in"];
                    this.authorization.token = token["access_token"];
                }
            } finally {
                new httpsClient(`${this.authorization.urls.api}/${method}`, {
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Authorization": "Bearer " + this.authorization.token,
                        "accept-encoding": "gzip, deflate, br"
                    }
                }).toJson.then((api) => {
                    if (!api) return resolve(locale.err("api.request.fail"));
                    else if (api instanceof Error) resolve(api);
                    else if (api.error) return resolve(locale.err( "api.request.fail.msg", [api.error.message]));

                    return resolve(api);
                }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
            }
        });
    };

    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     */
    protected static track = (track: any): Track => {
        return new Track({
            id: track.id,
            title: track.name,
            url: track["external_urls"]["spotify"],
            artist: {
                title: track["artists"][0].name,
                url: track["artists"][0]["external_urls"]["spotify"]
            },
            time: { total: (track["duration_ms"] / 1000).toFixed(0) as any },
            image: track.album.images.sort((item1: any, item2: any) => item1.width > item2.width)[0],
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI });