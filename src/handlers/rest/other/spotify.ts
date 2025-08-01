import { Assign, httpsClient, locale } from "#structures";
import type { RestServerSide } from "#handler/rest";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSpotifyAPI
 * @public
 */
class RestSpotifyAPI extends Assign<RestServerSide.API> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestServerSide.APIBase = {
        name: "SPOTIFY",
        color: 1420288,
        url: "open.spotify.com"
    };

    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        api: "https://api.spotify.com/v1",
        account: "https://accounts.spotify.com/api",

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
            filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/i,

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

                        return new Promise(async (resolve) => {
                            //Если ID трека не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err("api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(`${RestSpotifyAPI._platform.url}/${ID}`);

                            // Если трек есть в кеше
                            if (cache) {
                                if (!options.audio) return resolve(cache);

                                // Если включена утилита кеширования аудио
                                else if (db.cache.audio) {
                                    // Если есть кеш аудио
                                    if (db.cache.audio.status(`${RestSpotifyAPI._platform.url}/${ID}`).status === "ended") return resolve(cache);
                                }
                            }

                            try {
                                // Создаем запрос
                                const api = await RestSpotifyAPI.API(`tracks/${ID}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                const track = RestSpotifyAPI.track(api);

                                setImmediate(() => {
                                    // Сохраняем кеш в системе
                                    if (!cache) db.cache.set(track, RestSpotifyAPI._platform.url);
                                });

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

                        return new Promise(async (resolve) => {
                            // Если ID альбома не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.album"));

                            try {
                                // Создаем запрос
                                const api: Error | any = await RestSpotifyAPI.API(`albums/${ID}?offset=0&limit=${limit}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);

                                const tracks = api.tracks.items.map((track: any) => RestSpotifyAPI.track(track, api.images));

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

                        return new Promise(async (resolve) => {
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
                    name: "artist",
                    filter: /artist\/[0-9z]+/i,
                    execute: (url, {limit}) => {
                        const ID = /artist\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("artist\/")?.pop();

                        return new Promise(async (resolve) => {
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
                    execute: (query, {limit}) => {
                        return new Promise(async (resolve) => {
                            try {
                                // Создаем запрос
                                const api: Error | any = await RestSpotifyAPI.API(`search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);

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
                    url: `${this.authorization.account}/token`,
                    headers: {
                        "Authorization": `Basic ${Buffer.from(`${this.authorization.auth}`).toString('base64')}`,
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: "grant_type=client_credentials",
                    method: "POST"
                }).toJson;

                // Если при получении токена была получена ошибка
                if (token instanceof Error) return resolve(token);

                // Вносим данные авторизации
                this.authorization.time = Date.now() + token["expires_in"];
                this.authorization.token = token["access_token"];
            }

            // Нужно обновить токен
            if (!this.authorization.token || this.authorization.time <= Date.now()) await getToken();

            new httpsClient({
                url: `${this.authorization.api}/${method}`,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + this.authorization.token
                }
            }).toJson.then((api) => {
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
     * @param track - Трек из Spotify API
     * @param images - Сторонние картинки
     * @protected
     * @static
     */
    protected static track = (track: json, images?: any[]) => {
        const track_images = images?.length > 0 ? images : track?.album?.images || track?.images;

        return {
            id: track.id,
            title: track.name,
            url: track["external_urls"]["spotify"],
            artist: {
                title: track["artists"][0].name,
                url: track["artists"][0]["external_urls"]["spotify"]
            },
            time: { total: (track["duration_ms"] / 1000).toFixed(0) as any },
            image: track_images.sort((item1: any, item2: any) => item1.width > item2.width)[0],
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ RestSpotifyAPI ];