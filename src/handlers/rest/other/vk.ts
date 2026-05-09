import { APIRequestData, DeclareRest, OptionsRest, RestServerSide } from "#handler/rest/index.js";
import { httpsClient, locale } from "#structures";
import { sdb } from "#worker/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой VK, динамический плагин
 * # Types
 * - Track - Любое трек с платформы
 * - Search - Поиск треков, пока не доступны плейлисты, альбомы, авторы
 * @Specification Rest VK API
 * @Audio Доступно нативное получение только в RU регионе
 */

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestVKAPI
 * @public
 */
@DeclareRest({
    name: "VK",
    color: 30719,
    url: "vk.com",
    audio: true,
    auth: true,
    filter: /^(https?:\/\/)?(vk\.com)\/.+$/i
})
@OptionsRest({
    /**
     * @description Ссылка на метод API
     * @protected
     */
    api: "https://api.vk.com/method"
})
class RestVKAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /(audio)/i,
            execute: async (url, { audio }) => {
                const ID = this.getID(/(|-)[0-9]+_[0-9]+/i, url)?.at(0);

                // Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.track");

                // Интеграция с утилитой кеширования
                const cache = sdb.meta_saver?.get?.(`${this.url}/track/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    if (!audio) return cache;

                    // Если включена утилита кеширования аудио
                    else if (sdb.audio_saver) {
                        const check = await sdb.audio_saver.status(`${this.url}/${ID}`);

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
                    const api = await this.API("audio", "getById", `&audios=${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    const track = this.track(api.response.pop());

                    // Если указано получение аудио
                    if (audio && this.audio) {
                        // Если включена утилита кеширования
                        if (sdb.audio_saver) {
                            const check = await sdb.audio_saver.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                track.audio = check.path;
                                return track;
                            }
                        }
                    }

                    // Если нет ссылки на трек
                    if (!track.audio) return locale.err( "api.request.fail");

                    // Сохраняем кеш в системе
                    if (!cache) sdb.meta_saver?.set?.(track, `${this.url}/track`);

                    return track;
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о плейлисте или альбоме
         * @type "playlist"
         */
        {
            name: "playlist",
            filter: /(playlist|album)/i,
            execute: async (url, { limit }) => {
                const ID = this.getID(/(?:playlist|album)\/(?<owner_id>-?\d+)_(?<playlist_id>\d+)(?:_(?<access_hash>[a-f0-9]+))?/, url)?.groups ?? null;

                // Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api = await this.API("audio", "getPlaylistById", `&owner_id=${ID.owner_id}&playlist_id=${ID.playlist_id}&access_key=${ID.access_hash}&count=1`);

                    // Получаем список треков в формате ids
                    const tracks_ids = await this.API("audio", "getIdsBySource", `&entity_id=${ID.owner_id}_${ID.playlist_id}_${ID.access_hash}&source=playlist&ref=`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (tracks_ids instanceof Error) return tracks_ids;

                    // Получаем треки
                    const tracks_raw = await this.API("audio", "getById", `&audios=${(tracks_ids.response.audios as any[]).splice(0, limit).map((d) => d.audio_id).join(",")}`);

                    // Если запрос выдал ошибку то
                    if (tracks_raw instanceof Error) return tracks_raw;

                    const playlist = api.response;
                    const image = playlist.photo;
                    const tracks = tracks_raw.response.map(this.track);

                    return {
                        url: url,
                        title: playlist.title,
                        image: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined,
                        items: tracks
                    }
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных по поиску
         * @type "search"
         */
        {
            name: "search",
            execute: async (query, {limit}) => {
                try {
                    // Создаем запрос
                    const api = await this.API("audio", "search", `&q=${encodeURIComponent(query)}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    return (api.response.items.splice(0, limit)).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        }
    ];

    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     * @protected
     */
    protected API = (method: "audio" | "execute" | "catalog", type: "getById" | "search" | "getPlaylistById" | "getIdsBySource", options: string): Promise<json | Error> => {
        return new Promise((resolve) => {
            const url = `${this.options.api}/${method}.${type}` + `?access_token=${this.auth}${options}&v=5.95`;

            new httpsClient({
                url,
                agent: this.agent
            }).toJson.then((api: any) => {
                if (api?.["error_code"] || api?.error) return resolve(locale.err( "api.request.fail.msg", [api?.["error_msg"]]));

                // Если на этапе получение данных получена одна из ошибок
                else if (!api || !api?.response) return resolve(locale.err( "api.request.fail"));

                return resolve(api);
            }).catch((err) => {
                return resolve(Error(`[APIs]: ${err}`));
            });
        });
    };

    /**
     * @description Из полученных данных подготавливаем трек для Audio<Queue>
     * @param track {any} Любой трек из VK
     * @protected
     */
    protected track = (track: json) => {
        const image = track?.album?.["thumb"];

        return {
            id: `${track.owner_id}_${track.id}`,
            url: `https://vk.com/audio${track.owner_id}_${track.id}`,
            title: track.title,
            artist: this.author(track),
            image: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined,
            time: { total: track.duration.toFixed(0) },
            audio: track?.url
        };
    };

    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     * @protected
     */
    protected author = (user: any): APIRequestData.Artist => {
        const url = `https://vk.com/audio?performer=1&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestVKAPI];