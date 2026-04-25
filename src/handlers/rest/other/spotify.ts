import { DeclareRest, RestServerSide } from "#handler/rest/index.js";
import { httpsClient, locale } from "#structures";
import { sdb } from "#worker/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой Spotify, динамический плагин
 * # Types
 * - Track - Любое трек с платформы
 * - Playlist - Любой открытый плейлист
 * - Artist - Популярные треки автора с учетом лимита
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
    auth: false,
    filter: /^(https?:\/\/)?(open\.)?(m\.)?(spotify\.com|spotify\.?ru|spotify)\/.+$/i
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
            filter: /track\/[a-zA-Z0-9]+/i,
            execute: async (url, options) => {
                const ID = this.getID(/track\/[a-zA-Z0-9]+/, url)[0]?.split("track\/")?.pop();

                //Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err("api.request.id.track");

                // Интеграция с утилитой кеширования
                const cache = sdb.meta_saver?.get?.(`${this.url}/track/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    // Если включена утилита кеширования аудио
                    if (sdb.audio_saver) {
                        const check = sdb.audio_saver.status(`${this.url}/${ID}`);

                        // Если есть кеш аудио
                        if (check.status === "ended") {
                            cache.audio = check.path;
                            return cache;
                        }
                    }

                    // Если нет возможности получить аудио
                    if (!this.audio) return cache;
                }

                try {
                    // Создаем запрос
                    const api = await this.API(`track/${ID}`);

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

                        return track;
                    }

                    setImmediate(() => {
                        // Сохраняем кеш в системе
                        if (!cache) sdb.meta_saver?.set?.(track, `${this.url}/track`);
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
            filter: /album\/[a-zA-Z0-9]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/album\/[a-zA-Z0-9]+/, url)[0]?.split("album\/")?.pop();

                // Если ID альбома не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.album");

                // Интеграция с утилитой кеширования
                const cache = sdb.meta_saver?.get?.(`${this.url}/album/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    // Если нет возможности получить аудио
                    if (!this.audio) return cache;
                }

                try {
                    // Создаем запрос
                    const api: Error | any = await this.API(`album/${ID}?offset=0&limit=${Math.min(limit, 100)}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    // Подготавливаем все треки
                    const tracks = api.trackList.map((track: any) => this.track(track, api?.visualIdentity.image));

                    const album = {
                        id: ID,
                        url: `https://open.spotify/album/${ID}`,
                        title: api.name,
                        image: this.parseImages(api?.visualIdentity.image),
                        artist: {
                            name: api.subtitle,
                            url: `https://open.spotify/album/${ID}`
                        },
                        items: tracks
                    };

                    // Сохраняем кеш в системе
                    if (!cache) sdb.meta_saver?.set?.(album, `${this.url}/album`);
                    return album;
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
            filter: /playlist\/[a-zA-Z0-9]+/i,
            execute: async (url, {}) => {
                const ID = this.getID(/playlist\/[a-zA-Z0-9]+/, url)[0]?.split("playlist\/")?.pop();

                // Если ID плейлиста не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api: Error | any = await this.API(`playlist/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    const tracks = api.trackList.map(({ track }) => this.track(track, api?.visualIdentity.image));

                    return {
                        url: `https://open.spotify/playlist/${ID}`,
                        title: api.name,
                        image: this.parseImages(api?.visualIdentity.image),
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
            filter: /artist\/[a-zA-Z0-9]+/i,
            execute: async (url, {}) => {
                const ID = this.getID(/artist\/[a-zA-Z0-9]+/, url)[0]?.split("artist\/")?.pop();

                // Если ID автора не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.author");

                try {
                    // Создаем запрос
                    const api = await this.API(`artist/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    return (api.trackList).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных по поиску
         * @type "search"
         * @private
         * @deprecated
         */
        /*{
            name: "search",
            execute: async (query, {}) => {
                try {
                    // Создаем запрос
                    const api= await this.API(`search/${encodeURIComponent(query)}/tracks`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    return api.tracks.items.map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        }*/
    ]

    /**
     * @description Создаем запрос к SPOTIFY API и обновляем токен
     * @param method - Метод запроса из api
     * @protected
     */
    protected API = async (method: string) => {
        return new httpsClient(
            {
                url: `https://open.spotify.com/embed/${method}`,
                agent: this.agent
            }
        ).toString.then((d) => {
            if (d instanceof Error) return locale.err("api.request.fail");
            const fragment = JSON.parse(d.split("type=\"application/json\">")[1].split("</sc")[0]);

            if (fragment.props.pageProps.statusCode) return locale.err("api.request.fail");
            return fragment.props.pageProps.state.data.entity;
        });
    };

    protected parseImages = (image: any[]) => {
      const images = image.sort((a, b) => b.maxHeight - a.maxHeight);
      return images[0].url;
    };

    /**
     * @description Собираем трек в готовый образ
     * @param track - Трек из Spotify API
     * @param images - Сторонние картинки
     * @protected
     */
    protected track = (track: json, images?: any[]) => {
        const track_images = images?.length > 0 ? images : track?.visualIdentity?.image;

        return {
            id: track.id ?? (track.uri as string).split(":").pop(),
            title: track.title ?? track.name,
            url: `https://open.spotify.com/track/${track.id}`,
            artist: {
                title: (track.artists ? track.artists[0].name : track.subtitle)?.split?.(",")?.[0],
                url: track.artists ? `https://open.spotify.com/artist/${((track["artists"][0].uri) as string).split(":").pop()}` : `https://open.spotify.com/track/${track.id}`
            },
            time: { total: (track["duration"] / 1000).toFixed(0) },
            image: this.parseImages(track_images),
            audio: null
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ RestSpotifyAPI ];