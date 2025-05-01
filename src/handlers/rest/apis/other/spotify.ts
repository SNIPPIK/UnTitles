import {RestAPI, RestAPIBase} from "@handler/rest/apis";
import {httpsClient} from "@handler/rest";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Assign} from "@utils";
import {env, db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSpotifyAPI
 * @public
 */
class RestSpotifyAPI extends Assign<RestAPI> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestAPIBase = {
        name: "SPOTIFY",
        color: 1420288,
        url: "open.spotify.com"
    };

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
        auth: env.get("token.spotify", null),

        /**
         * @description Токен авторизации
         * @protected
         */
        token: null,

        /**
         * @description Время жизни токена
         * @protected
         */
        time: 0
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor RestSpotifyAPI
     * @public
     */
    public constructor() {
        super({ ...RestSpotifyAPI._platform,
            audio: false,
            auth: !!RestSpotifyAPI.authorization.auth,
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/gi,

            requests: [
                /**
                 * @description Запрос данных о треке
                 * @type "track"
                 */
                {
                    name: "track",
                    filter: /track\/[0-9z]+/i,
                    execute: (url: string, options) => {
                        const ID = /track\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("track\/")?.pop();

                        return new Promise<Track | Error>(async (resolve) => {
                            //Если ID трека не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err("api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(`${RestSpotifyAPI._platform.url}/${ID}`);

                            // Если трек есть в кеше
                            if (cache) {
                                // Если включена утилита кеширования аудио
                                if (db.cache.audio) {
                                    // Если есть кеш аудио
                                    if (db.cache.audio.status(cache).status === "ended") return resolve(cache);
                                    else if (!options.audio) return resolve(cache);
                                }
                            }

                            try {
                                // Создаем запрос
                                const api = await RestSpotifyAPI.API(`tracks/${ID}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                const track = RestSpotifyAPI.track(api);

                                db.cache.set(track);

                                return resolve(track);
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных об альбоме
                 * @type "album"
                 */
                {
                    name: "album",
                    filter: /album\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /album\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("album\/")?.pop();

                        return new Promise<Track.list | Error>(async (resolve) => {
                            // Если ID альбома не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.album"));

                            try {
                                // Создаем запрос
                                const api: Error | any = await RestSpotifyAPI.API(`albums/${ID}?offset=0&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);

                                const tracks = api.tracks.items.map(RestSpotifyAPI.track)

                                return resolve({ url, title: api.name, image: api.images[0], items: tracks, artist: api?.["artists"][0] });
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных об плейлисте
                 * @type "playlist"
                 */
                {
                    name: "playlist",
                    filter: /playlist\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /playlist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("playlist\/")?.pop();

                        return new Promise<Track.list | Error>(async (resolve) => {
                            // Если ID плейлиста не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.playlist"));

                            try {
                                // Создаем запрос
                                const api: Error | any = await RestSpotifyAPI.API(`playlists/${ID}?offset=0&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                const tracks = api.tracks.items.map(({ track }) => RestSpotifyAPI.track(track));

                                return resolve({ url, title: api.name, image: api.images[0], items: tracks });
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных треков артиста
                 * @type "author"
                 */
                {
                    name: "author",
                    filter: /artist\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /artist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("artist\/")?.pop();

                        return new Promise<Track[] | Error>(async (resolve) => {
                            // Если ID автора не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.author"));

                            try {
                                // Создаем запрос
                                const api = await RestSpotifyAPI.API(`artists/${ID}/top-tracks?market=ES&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);

                                return resolve((api.tracks?.items ?? api.tracks).map(RestSpotifyAPI.track));
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных по поиску
                 * @type "search"
                 */
                {
                    name: "search",
                    execute: (url, {limit}) => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                // Создаем запрос
                                const api: Error | any = await RestSpotifyAPI.API(`search?q=${url}&type=track&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);

                                return resolve(api.tracks.items.map(RestSpotifyAPI.track));
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                }
            ]
        });
    };

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method - Метод запроса из api
     * @protected
     * @static
     */
    protected static API = (method: string): Promise<json | Error> => {
        return new Promise(async (resolve) => {
            const getToken = async () => {
                const token = await new httpsClient({
                    url: `${this.authorization.urls.account}/token`,
                    headers: {
                        "Authorization": `Basic ${Buffer.from(`${this.authorization.auth}`).toString('base64')}`,
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: "grant_type=client_credentials",
                    method: "POST"
                }).send();

                // Если при получении токена была получена ошибка
                if (token instanceof Error) return resolve(token);

                // Вносим данные авторизации
                this.authorization.time = Date.now() + token["expires_in"];
                this.authorization.token = token["access_token"];
            }

            // Нужно обновить токен
            if (!this.authorization.token || this.authorization.time < Date.now()) await getToken();

            new httpsClient({
                url: `${this.authorization.urls.api}/${method}`,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + this.authorization.token
                }
            }).send().then((api) => {
                // Если на этапе получение данных получена одна из ошибок
                if (!api) return resolve(locale.err("api.request.fail"));
                else if (api instanceof Error) return resolve(api);
                else if (api.error) return resolve(locale.err("api.request.fail.msg", [api.error.message]));

                return resolve(api);
            }).catch((err) => {
                return resolve(Error(`[APIs]: ${err}`));
            });
        });
    };

    /**
     * @description Собираем трек в готовый образ
     * @param track {any} Трек из Spotify API
     * @protected
     * @static
     */
    protected static track = (track: json): Track => {
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
        }, RestSpotifyAPI._platform);
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestSpotifyAPI];