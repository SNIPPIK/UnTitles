import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale, Logger } from "#structures";
import crypto from "node:crypto";
import { env } from "#app/env";
import { db } from "#app/db";

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
    keys: ["kzqU4XhfCaY6B6JTHODeq5", "XGRlBW9FXlekgbPrRHuSiA"],

    /**
     * @description Доступные заголовки
     */
    agents: [
        // Windows Desktop
        "YandexMusicDesktopAppWindows/5.13.2",

        // Phone Android
        "YandexMusicAndroid/2025071"
    ],
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
                const ID = /track\/[0-9]+/gi.exec(url)[0]?.split("track")?.at(1);

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
                const ID = /track\/[0-9]+/gi.exec(url)[0]?.split("track")?.at(1);

                // Если ID трека не удалось извлечь из ссылки
                if (!ID) return locale.err( "api.request.id.track");

                // Интеграция с утилитой кеширования
                const cache = db.cache.get(`${this.url}/${ID}`);

                // Если трек есть в кеше
                if (cache) {
                    if (!options.audio) return cache;

                    // Если включена утилита кеширования аудио
                    else if (db.cache.audio) {
                        const check = db.cache.audio.status(`${this.url}/${ID}`);

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
                        if (db.cache.audio) {
                            const check = db.cache.audio.status(`${this.url}/${ID}`);

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
                        if (!cache) db.cache.set(track, this.url);
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
                const ID = /[0-9]+/i.exec(url)?.at(0)?.split("album")?.at(0);

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

                    return {url, title: api.title, image: AlbumImage, items: songs};
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
            filter: /(playlists\/[a0-Z9.-]*)/i,
            execute: async (url, {limit}) => {
                const ID = /(playlists\/[a0-Z9.-]*)/i.exec(url)[0].split("/")[1];

                if (!ID) return locale.err("api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api = await this.API(`playlist/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (api?.tracks?.length === 0) return locale.err("api.request.fail.msg", ["Not found tracks in playlist"]);

                    const image = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                    const tracks: any[] = api.tracks?.splice(0, limit);
                    const songs = tracks.map(({track}) => this.track(track));

                    return {
                        url, title: api.title, image: image, items: songs,
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
                const ID = /(artist)\/[0-9]+/i.exec(url)?.at(0)?.split("artist")?.at(0);

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
     * @static
     */
    protected API = (method: string): Promise<json> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient({
                url: `${this.options.api}/${method}`,
                headers: {
                    "Authorization": "OAuth " + this.auth,
                    "X-Yandex-Music-Client": method?.startsWith("get-file-info") ? this.options.agents[0] : this.options.agents[1]
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
     * @static
     */
    protected getAudio = async (ID: string): Promise<Error | string> => {
        const trackId = ID.split("/")[1];

        for (let i = 0; i <= 3; i++) {
            // Если достигли максимума
            if (i === 3) {
                Logger.log("ERROR", Error("Max requests getAudio in yandex"));
                return locale.err("api.request.fail.msg", ["Fail getting audio url"]);
            }

            try { /* Flac Audio handler */
                const timestamp = Math.floor(Date.now() / 1000);
                const encoder = new TextEncoder();
                const keyData = encoder.encode(this.options.keys[0]);
                const cryptoKey = await crypto.subtle.importKey("raw", keyData, {
                    name: "HMAC",
                    hash: {name: "SHA-256"}
                }, false, ["sign"]);
                const dataEncoded = encoder.encode(`${timestamp}${trackId}losslessflacaache-aacmp3raw`);
                const signature = await crypto.subtle.sign("HMAC", cryptoKey, dataEncoded);
                const sign = btoa(String.fromCharCode(...new Uint8Array(signature)));
                const params = new URLSearchParams({
                    ts: `${timestamp}`,
                    trackId: trackId,
                    quality: "lossless",
                    codecs: "flac,aac,he-aac,mp3",
                    transports: "raw",

                    // Удаляем лишний символ с конца (=)
                    sign: sign.slice(0, -1)
                });

                // Делаем запрос для получения аудио
                const api = await this.API(`get-file-info?${params.toString()}`) as {
                    downloadInfo: { url: string, trackId: string, realId: string }
                };

                // Если yandex пытается подсунуть рекламу вместо реального аудио
                if (api.downloadInfo.trackId !== trackId || api.downloadInfo.realId !== trackId) continue;

                return api.downloadInfo.url;
            } catch { /* MP3 Audio handler */
                try {
                    // Делаем запрос для получения аудио
                    const api = await this.API(`tracks/${trackId}/download-info`);

                    // Если на этапе получение данных получена одна из ошибок
                    if (!api) return locale.err("api.request.fail.msg", ["Fail getting audio file, api as 0"]);
                    else if (api instanceof Error) return api;
                    else if (api.length === 0) return locale.err("api.request.fail.msg", ["Fail getting audio file, api.size as 0"]);

                    const url = api.find((data: any) => data.codec !== "aac") as { downloadInfoUrl: string };

                    // Если нет ссылки на xml
                    if (!url) return locale.err("api.request.fail.msg", ["Fail getting audio url"]);

                    // Если yandex пытается подсунуть рекламу вместо реального аудио
                    else if (`${url.downloadInfoUrl.split(".").at(-1).split("/")[0]}` !== trackId) continue;

                    // Расшифровываем xml страницу на фрагменты
                    new httpsClient({
                        url: url["downloadInfoUrl"],
                        headers: {
                            "X-Yandex-Music-Client": this.options.agents[1]
                        }
                    }).toXML.then((xml) => {
                        if (xml instanceof Error) return xml;

                        const path = xml[1];
                        const sign = crypto.createHash("md5").update(this.options.keys[1] + path.slice(1) + xml[4]).digest("hex");

                        return `https://${xml[0]}/get-mp3/${sign}/${xml[2]}${path}`;
                    }).catch((e) => {
                        return e instanceof Error ? e : Error(String(e));
                    });
                } catch (err) {
                    return Error(err as string);
                }
            }
        }

        return null;
    };

    /**
     * @description Расшифровываем картинку
     * @param image - Данные о картинке
     * @param size - Размер картинки
     * @protected
     * @static
     */
    protected parseImage = ({image, size = 1e3}: { image: string, size?: number }): string => {
        if (!image) return null;
        return `https://${image.split("%%")[0]}m${size}x${size}`;
    };

    /**
     * @description Из полученных данных подготавливаем трек для Audio<Queue>
     * @param track - Данные трека
     * @protected
     * @static
     */
    protected track = (track: any) => {
        const author = track["artists"]?.length ? track["artists"]?.pop() : track["artists"];
        const album = track["albums"]?.length ? track["albums"][0] : track["albums"];
        const image = this.parseImage({image: album?.["ogImage"] ?? album?.["coverUri"] ?? track?.["ogImage"] ?? track?.["coverUri"]}) ?? null

        return {
            id: `${album.id}_${track.id}`,
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image,
            url: `https://${this.url}/album/${album.id}/track/${track.id}`,
            time: { total: (track["durationMs"] / 1000).toFixed(0) ?? "250" as any },

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