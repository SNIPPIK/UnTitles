import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import crypto from "node:crypto";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой Yandex, динамический плагин
 * # Types
 * - Track - Любое трек с платформы
 * - Playlist - Любой открытый плейлист
 * - Artist - Популярные треки автора с учетом лимита
 * - Related - Похожее треки, работает через алгоритмы yandex
 * - Search - Поиск треков, пока не доступны плейлисты, альбомы, авторы
 * @Specification Rest Yandex API
 * @Audio Доступно нативное получение
 */

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestYandexAPI
 * @public
 */
@DeclareRest({
    name: "YANDEX",
    color: 16705372,
    url: "music.yandex.ru",
    audio: true,
    auth: env.get<string>("token.yandex", null),
    filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/i
})
@OptionsRest({
    /**
     * @description Ссылка на метод API
     * @protected
     */
    api: "https://api.music.yandex.net",

    /**
     * @description Ключи для расшифровки ссылок
     * @protected
     */
    keys: ["p93jhgh689SBReK6ghtw62", "XGRlBW9FXlekgbPrRHuSiA"],
})
class RestYandexAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос треков из волны, для выполнения требуется указать list=RD в ссылке
         * @type "related"
         */
        {
            name: "related",
            filter: /(track\/[0-9]+)?(list=RD)/,
            execute: async (url) => {
                const ID = this.getID(/track\/[0-9]+/gi, url)?.split("track")?.at(1);

                // Если ID альбома не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.album");

                try {
                    // Создаем запрос
                    const api = await this.API(`tracks/${ID}/similar`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (!api["similarTracks"]?.length) return locale.err("api.request.fail.msg", ["0 tracks received"]);

                    const songs = api["similarTracks"].map(this.track);
                    return {url, title: null, image: null, items: songs};
                } catch (e) {
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /track\/[0-9]+/i,
            execute: async (url, options) => {
                const ID = this.getID(/track\/[0-9]+/gi, url)?.split("track")?.at(1);

                // Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.track");

                // Интеграция с утилитой кеширования
                const cache = db.meta_saver?.get(`${this.url}/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    if (!options.audio) return cache;

                    // Если включена утилита кеширования аудио
                    else if (db.audio_saver) {
                        const check = db.audio_saver.status(`${this.url}/${ID}`);

                        // Если есть кеш аудио
                        if (check.status === "ended") {
                            cache.audio = check.path;
                            return cache;
                        }
                    }
                }

                try {
                    // Делаем запрос
                    const api = await this.API(`tracks/${ID}`);

                    // Обрабатываем ошибки
                    if (api instanceof Error) return api;
                    else if (!api[0]) return locale.err( "api.request.fail");

                    const track = this.track(api[0]);

                    // Если указано получение аудио
                    if (options.audio) {
                        // Если включена утилита кеширования
                        if (db.audio_saver) {
                            const check = db.audio_saver.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                track.audio = check.path;
                                return track;
                            }
                        }

                        const link = await this.getAudio(ID);

                        // Проверяем не получена ли ошибка при расшифровке ссылки на исходный файл
                        if (link instanceof Error) return link;
                        track["audio"] = link;
                    }

                    setImmediate(() => {
                        // Сохраняем кеш в системе
                        if (!cache) db.meta_saver.set(track, this.url);
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
         */
        {
            name: "album",
            filter: /(album)\/[0-9]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/[0-9]+/i, url)?.split("album")?.at(0);

                // Если ID альбома не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.album");

                try {
                    // Создаем запрос
                    const api = await this.API(`albums/${ID}/with-tracks`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return locale.err("api.request.fail");

                    const AlbumImage = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                    const tracks = api["volumes"]?.pop().splice(0, limit);
                    const songs = tracks.map(this.track);

                    return {id: ID, url, title: api.title, image: AlbumImage, items: songs};
                } catch (e) {
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных об плейлисте
         * @type "playlist"
         */
        {
            name: "playlist",
            filter: /(playlists\/[0-9a-f-]+)/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/(playlists\/[0-9a-f-]+)/i, url).split("/")[1];

                // Если ID альбома не удалось извлечь из ссылки
                if (!ID) return locale.err("api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api = await this.API(`playlist/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (!api?.tracks) return locale.err("api.request.fail.msg", ["Not found playlist"]);
                    else if (api?.tracks?.length === 0) return locale.err("api.request.fail.msg", ["Not found tracks in playlist"]);

                    const image = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                    const tracks: any[] = api.tracks?.splice(0, limit);
                    const songs = tracks.map(({track}) => this.track(track));

                    return {
                        url: `https://music.yandex.ru/playlists/${ID}`,
                        title: api.title, image: image, items: songs,
                        artist: {
                            title: api.owner.name,
                            url: `https://music.yandex.ru/users/${ID[1]}`
                        }
                    };
                } catch (e) {
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных треков артиста
         * @type "artist"
         */
        {
            name: "artist",
            filter: /(artist)\/[0-9]+/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/[0-9]+/i, url);

                // Если ID автора не удалось извлечь из ссылки
                if (!ID) return locale.err("api.request.id.author");

                try {
                    // Создаем запрос
                    const api = await this.API(`artists/${ID}/tracks`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    return api.tracks.splice(0, limit).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`)
                }
            }
        },

        /**
         * @description Запрос данных по поиску
         * @type search
         */
        {
            name: "search",
            execute: async (query , {limit}) => {
                try {
                    // Создаем запрос
                    const api = await this.API(`search?type=all&text=${encodeURIComponent(query)}&page=0&nococrrect=false`);

                    // Обрабатываем ошибки
                    if (api instanceof Error) return api;
                    else if (!api.tracks) return [];

                    return api.tracks["results"].splice(0, limit).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`)
                }
            }
        }
    ];

    /**
     * @description Делаем запрос на {data.api}/methods
     * @param method - Метод запроса из api
     * @protected
     */
    protected API = (method: string): Promise<json> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient({
                url: `${this.options.api}/${method}`,
                headers: {
                    "Authorization": "OAuth " + this.auth
                },
                method: "GET",
            }).toJson.then((req) => {
                // Если на этапе получение данных получена одна из ошибок
                if (!req || req instanceof Error) return resolve(locale.err("api.request.fail"));
                else if (req?.error?.name === "session-expired") return resolve(locale.err("api.request.login.session-expired"));
                else if (req?.error?.name === "not-allowed") return resolve(locale.err("api.request.login.not-allowed"));

                if (req?.result) return resolve(req?.result);
                return resolve(req);
            }).catch((err) => {
                return resolve(Error(`[APIs]: ${err}`));
            });
        });
    };

    /**
     * @description Получаем исходный файл трека
     * @param ID - ID трека
     * @support MP3, Lossless
     * @protected
     */
    protected getAudio = async (ID: string): Promise<Error | string> => {
        const trackId = ID.split("/")[1];

        for (let i = 0; i <= 3; i++) {
            // Если достигли максимума, возвращаем ошибку
            if (i === 3) {
                return locale.err("api.request.fail.msg", ["Fail getting audio url"]);
            }

            try {
                // Делаем запрос для получения аудио
                const api = await new httpsClient({
                    url: `https://api.music.yandex.net/tracks/${trackId}/download-info`,
                    headers: {
                        "Authorization": "OAuth " + this.auth
                    },
                    method: "GET",
                }).toJson;

                // Если на этапе получение данных получена одна из ошибок
                if (!api) return locale.err("api.request.fail.msg", ["Fail getting audio file, api as 0"]);
                else if (api instanceof Error) return api;
                else if (api?.result?.length === 0) return locale.err("api.request.fail.msg", ["Fail getting audio file, api.size as 0"]);

                const url = api?.result.find((data: any) => data.codec !== "aac") as { downloadInfoUrl: string };

                // Если нет ссылки на xml
                if (!url) return locale.err("api.request.fail.msg", ["Fail getting audio url"]);

                // Если yandex пытается подсунуть рекламу вместо реального аудио
                else if (`${url.downloadInfoUrl.split(".").at(-1)!.split("/")[0]}` !== trackId) continue;

                // Расшифровываем xml страницу на фрагменты
                const xml = await new httpsClient({
                    url: url["downloadInfoUrl"],
                    headers: {
                        "Authorization": "OAuth " + this.auth
                    },
                    method: "GET",
                }).toXML;

                // Если произошла ошибка при получении xml
                if (xml instanceof Error) return locale.err("api.request.fail.msg", ["Fail parsing xml page"]);

                const path = xml[1];
                const sign = crypto.createHash("md5").update(this.options.keys[1] + path.slice(1) + xml[4]).digest("hex");

                // Успех, возвращаем результат и прерываем цикл
                return `https://${xml[0]}/get-mp3/${sign}/${xml[2]}${path}`;

            } catch (mp3Error) {
                // Если MP3 handler также бросил ошибку, выводим её и продолжаем цикл (i++)
                console.error("MP3 Handler Failed. Retrying...", mp3Error);
            }
        }

        // Достичь этого return-а в рабочем цикле невозможно, но добавлен для соответствия сигнатуре Promise<T>
        return locale.err("api.request.fail.msg", ["Failed to retrieve audio after all retries."]);
    };

    /**
     * @description Расшифровываем картинку
     * @param image - Данные о картинке
     * @param size - Размер картинки
     * @protected
     */
    protected parseImage = ({image, size = 1e3}: { image: string, size?: number }): string => {
        if (!image) return null;
        return `https://${image.split("%%")[0]}m${size}x${size}`;
    };

    /**
     * @description Из полученных данных подготавливаем трек для Audio<Queue>
     * @param track - Данные трека
     * @protected
     */
    protected track = (track: any) => {
        const author = track["artists"]?.length ? track["artists"]?.pop() : track["artists"];
        const album = track["albums"]?.length ? track["albums"][0] : track["albums"];
        const image = this.parseImage({image: album?.["ogImage"] ?? album?.["coverUri"] ?? track?.["ogImage"] ?? track?.["coverUri"]}) ?? null;

        return {
            id: `${album.id}_${track.id}`,
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image,
            url: `https://${this.url}/album/${album.id}/track/${track.id}`,
            time: { total: (track["durationMs"] / 1000).toFixed(0) ?? "250" },

            artist: track.author ?? {
                title: author?.name,
                url: `https://${this.url}/artist/${author.id}`,
                image: this.parseImage({image: author?.["ogImage"] ?? author?.["coverUri"]}) ?? null
            },
            audio: null
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestYandexAPI];