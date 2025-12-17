import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { sdb } from "#worker/db";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой Spotify, динамический плагин
 * # Types
 * - Track - Любое трек с платформы
 * - Playlist - Любой открытый плейлист
 * - Artist - Популярные треки автора с учетом лимита
 * - Search - Поиск треков, пока не доступны плейлисты, альбомы, авторы
 * @Specification Rest Spotify API
 * @Audio Не доступно нативное получение
 */

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
         * @private
         */
        {
            name: "track",
            filter: /track\/[0-9z]+/i,
            execute: async (url, options) => {
                const ID = this.getID(/track\/[a-zA-Z0-9]+/, url)?.split("track\/")?.pop();

                //Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err("api.request.id.track");

                // Интеграция с утилитой кеширования
                const cache = sdb.meta_saver?.get(`${this.url}/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    if (!options.audio) return cache;

                    // Если включена утилита кеширования аудио
                    else if (sdb.audio_saver) {
                        const check = sdb.audio_saver.status(`${this.url}/${ID}`);

                        // Если есть кеш аудио
                        if (check.status === "ended") {
                            cache.audio = check.path;
                            return cache;
                        }
                    }
                }

                try {
                    // Создаем запрос
                    const api = await this.API(`tracks/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    const track = this.track(api);

                    // Если указано получение аудио
                    if (options.audio) {
                        // Если включена утилита кеширования
                        if (sdb.audio_saver) {
                            const check = sdb.audio_saver.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                track.audio = check.path;
                                return track;
                            }
                        }
                    }

                    setImmediate(() => {
                        // Сохраняем кеш в системе
                        if (!cache) sdb.meta_saver.set(track, this.url);
                    });

                    return track;
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных об альбоме
         * @type "album"
         * @private
         */
        {
            name: "album",
            filter: /album\/[0-9z]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/album\/[a-zA-Z0-9]+/, url)?.split("album\/")?.pop();

                // Если ID альбома не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.album");

                try {
                    // Создаем запрос
                    const api: Error | any = await this.API(`albums/${ID}?offset=0&limit=${limit}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    // Подготавливаем все треки
                    const tracks = api.tracks.items.map((track: any) => this.track(track, api.images));
                    return {
                        id: ID,
                        url: `https://open.spotify/album/${ID}`,
                        title: api.name,
                        image: api.images[0],
                        items: tracks,
                        artist: api?.["artists"][0]
                    };
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных об плейлисте
         * @type "playlist"
         * @private
         */
        {
            name: "playlist",
            filter: /playlist\/[0-9z]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/playlist\/[a-zA-Z0-9]+/, url)?.split("playlist\/")?.pop();

                // Если ID плейлиста не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api: Error | any = await this.API(`playlists/${ID}?offset=0&limit=${limit}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    const tracks = api.tracks.items.map(({ track }) => this.track(track));

                    return {
                        url: `https://open.spotify/playlist/${ID}`,
                        title: api.name,
                        image: api.images[0],
                        items: tracks
                    };
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных треков артиста
         * @type "author"
         * @private
         */
        {
            name: "artist",
            filter: /artist\/[0-9z]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/artist\/[a-zA-Z0-9]+/, url)?.split("artist\/")?.pop();

                // Если ID автора не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.author");

                try {
                    // Создаем запрос
                    const api = await this.API(`artists/${ID}/top-tracks?market=ES&limit=${limit}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    return (api.tracks?.items ?? api.tracks).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных по поиску
         * @type "search"
         * @private
         */
        {
            name: "search",
            execute: async (query, {limit}) => {
                try {
                    // Создаем запрос
                    const api: Error | any = await this.API(`search?q=${encodeURIComponent(query)}&type=track&limit=${limit}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    return api.tracks.items.map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        }
    ]

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method - Метод запроса из api
     * @protected
     */
    protected API = (method: string): Promise<json | Error> => {
        return new Promise(async (resolve) => {
            // Нужно обновить токен
            if (!this.options.token || this.options.time <= Date.now()) await this.authorization();

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
     * @description Авторизация на spotify
     * @protected
     */
    protected async authorization(): Promise<Error> {
        const token = await new httpsClient({
            url: `${this.options.account}/token`,
            headers: {
                "Authorization": `Basic ${Buffer.from(`${this.auth}`).toString("base64")}`,
                "Content-Type": "application/x-www-form-urlencoded"
            },
            body: "grant_type=client_credentials",
            method: "POST"
        }).toJson;

        // Если при получении токена была получена ошибка
        if (token instanceof Error) {
            return this.authorization();
        }

        // Вносим данные авторизации
        this.options.time = Date.now() + token["expires_in"];
        this.options.token = token["access_token"];

        return super.authorization();
    };

    /**
     * @description Собираем трек в готовый образ
     * @param track - Трек из Spotify API
     * @param images - Сторонние картинки
     * @protected
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
            time: { total: (track["duration_ms"] / 1000).toFixed(0) },
            image: track_images.sort((item1: any, item2: any) => item1.width > item2.width)[0].url,
            audio: null
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ RestSpotifyAPI ];