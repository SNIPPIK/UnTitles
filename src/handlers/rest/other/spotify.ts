import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSpotifyAPI
 * @public
 */
@DeclareRest({
    name: "SPOTIFY",
    color: 1420288,
    url: "open.spotify.com",
    audio: false,
    auth: env.get("token.spotify", null),
    filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru)\/.+$/i
})
@OptionsRest({
    /**
     * @description Ссылка для работы API
     * @protected
     */
    api: "https://api.spotify.com/v1",

    /**
     * @description Ссылки для авторизации
     * @protected
     */
    account: "https://accounts.spotify.com/api",

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
})
class RestSpotifyAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /track\/[0-9z]+/i,
            execute: (url, options) => {
                const ID = /track\/[a-zA-Z0-9]+/.exec(url)?.pop()?.split("track\/")?.pop();

                return new Promise(async (resolve) => {
                    //Если ID трека не удалось извлечь из ссылки
                    if (!ID) return resolve(locale.err("api.request.id.track"));

                    // Интеграция с утилитой кеширования
                    const cache = db.cache.get(`${this.url}/${ID}`);

                    // Если трек есть в кеше
                    if (cache) {
                        if (!options.audio) return resolve(cache);

                        // Если включена утилита кеширования аудио
                        else if (db.cache.audio) {
                            const check = db.cache.audio.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                cache.audio = check.path;
                                return resolve(cache);
                            }
                        }
                    }

                    try {
                        // Создаем запрос
                        const api = await this.API(`tracks/${ID}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        const track = this.track(api);

                        // Если указано получение аудио
                        if (options.audio) {
                            // Если включена утилита кеширования
                            if (db.cache.audio) {
                                const check = db.cache.audio.status(`${this.url}/${ID}`);

                                // Если есть кеш аудио
                                if (check.status === "ended") {
                                    track.audio = check.path;
                                    return resolve(track);
                                }
                            }
                        }

                        setImmediate(() => {
                            // Сохраняем кеш в системе
                            if (!cache) db.cache.set(track, this.url);
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
                        const api: Error | any = await this.API(`albums/${ID}?offset=0&limit=${limit}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);

                        const tracks = api.tracks.items.map((track: any) => this.track(track, api.images));

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
                        const api: Error | any = await this.API(`playlists/${ID}?offset=0&limit=${limit}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        const tracks = api.tracks.items.map(({ track }) => this.track(track));

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
                        const api = await this.API(`artists/${ID}/top-tracks?market=ES&limit=${limit}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);

                        return resolve((api.tracks?.items ?? api.tracks).map(this.track));
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
                        const api: Error | any = await this.API(`search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);

                        return resolve(api.tracks.items.map(this.track));
                    } catch (e) {
                        return resolve(new Error(`[APIs]: ${e}`))
                    }
                });
            }
        }
    ]

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method - Метод запроса из api
     * @protected
     * @static
     */
    protected API = (method: string): Promise<json | Error> => {
        return new Promise(async (resolve) => {
            const getToken = async () => {
                const token = await new httpsClient({
                    url: `${this.options.account}/token`,
                    headers: {
                        "Authorization": `Basic ${Buffer.from(`${this.auth}`).toString('base64')}`,
                        "Content-Type": "application/x-www-form-urlencoded"
                    },
                    body: "grant_type=client_credentials",
                    method: "POST"
                }).toJson;

                // Если при получении токена была получена ошибка
                if (token instanceof Error) return resolve(token);

                // Вносим данные авторизации
                this.options.time = Date.now() + token["expires_in"];
                this.options.token = token["access_token"];
            }

            // Нужно обновить токен
            if (!this.options.token || this.options.time <= Date.now()) await getToken();

            new httpsClient({
                url: `${this.options.api}/${method}`,
                headers: {
                    "Content-Type": "application/x-www-form-urlencoded",
                    "Authorization": "Bearer " + this.options.token
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
    protected track = (track: json, images?: any[]) => {
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
            audio: null
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ RestSpotifyAPI ];