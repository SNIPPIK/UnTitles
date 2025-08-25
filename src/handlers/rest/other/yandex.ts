import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
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
            execute: (url) => {
                const ID = /track\/[0-9]+/gi.exec(url)[0]?.split("track")?.at(1);

                return new Promise(async (resolve) => {
                    // Если ID альбома не удалось извлечь из ссылки
                    if (!ID) return resolve(locale.err( "api.request.id.album"));

                    try {
                        // Создаем запрос
                        const api = await this.API(`tracks/${ID}/similar`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        else if (!api["similarTracks"]?.length) return resolve(locale.err("api.request.fail.msg", ["0 tracks received"]));

                        const songs = api["similarTracks"].map(this.track);
                        return resolve({url, title: null, image: null, items: songs});
                    } catch (e) {
                        return resolve(Error(`[APIs]: ${e}`))
                    }
                });
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /track\/[0-9]+/i,
            execute: (url, options) => {
                const ID = /track\/[0-9]+/gi.exec(url)[0]?.split("track")?.at(1);

                return new Promise(async (resolve) => {
                    // Если ID трека не удалось извлечь из ссылки
                    if (!ID) return resolve(locale.err( "api.request.id.track"));

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
                        // Делаем запрос
                        const api = await this.API(`tracks/${ID}`);

                        // Обрабатываем ошибки
                        if (api instanceof Error) return resolve(api);
                        else if (!api[0]) return resolve(locale.err( "api.request.fail"));

                        const track = this.track(api[0]);

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

                            const link = await this.getAudio(ID);

                            // Проверяем не получена ли ошибка при расшифровке ссылки на исходный файл
                            if (link instanceof Error) return resolve(link);
                            track["audio"] = link;
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
            filter: /(album)\/[0-9]+/i,
            execute: (url, {limit}) => {
                const ID = /[0-9]+/i.exec(url)?.at(0)?.split("album")?.at(0);

                return new Promise(async (resolve) => {
                    // Если ID альбома не удалось извлечь из ссылки
                    if (!ID) return resolve(locale.err( "api.request.id.album"));

                    try {
                        // Создаем запрос
                        const api = await this.API(`albums/${ID}/with-tracks`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return resolve(locale.err("api.request.fail"));

                        const AlbumImage = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                        const tracks = api["volumes"]?.pop().splice(0, limit);
                        const songs = tracks.map(this.track);

                        return resolve({url, title: api.title, image: AlbumImage, items: songs});
                    } catch (e) {
                        return resolve(Error(`[APIs]: ${e}`))
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
            filter: /(playlists\/[a0-Z9.-]*)/i,
            execute: (url, {limit}) => {
                const ID = /(playlists\/[a0-Z9.-]*)/i.exec(url)[0].split("/")[1];

                return new Promise(async (resolve) => {
                    if (!ID) return resolve(locale.err("api.request.id.playlist"));

                    try {
                        // Создаем запрос
                        const api = await this.API(`playlist/${ID}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        else if (api?.tracks?.length === 0) return resolve(locale.err("api.request.fail.msg", ["Not found tracks in playlist"]));

                        const image = this.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                        const tracks: any[] = api.tracks?.splice(0, limit);
                        const songs = tracks.map(({track}) => this.track(track));

                        return resolve({
                            url, title: api.title, image: image, items: songs,
                            artist: {
                                title: api.owner.name,
                                url: `https://music.yandex.ru/users/${ID[1]}`
                            }
                        });
                    } catch (e) {
                        return resolve(Error(`[APIs]: ${e}`))
                    }
                });
            }
        },

        /**
         * @description Запрос данных треков артиста
         * @type "artist"
         */
        {
            name: "artist",
            filter: /(artist)\/[0-9]+/i,
            execute: (url, {limit}) => {
                const ID = /(artist)\/[0-9]+/i.exec(url)?.at(0)?.split("artist")?.at(0);

                return new Promise(async (resolve) => {
                    // Если ID автора не удалось извлечь из ссылки
                    if (!ID) return resolve(locale.err("api.request.id.author"));

                    try {
                        // Создаем запрос
                        const api = await this.API(`artists/${ID}/tracks`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        const tracks = api.tracks.splice(0, limit).map(this.track);

                        return resolve(tracks);
                    } catch (e) {
                        return resolve(new Error(`[APIs]: ${e}`))
                    }
                });
            }
        },

        /**
         * @description Запрос данных по поиску
         * @type search
         */
        {
            name: "search",
            execute: (query , {limit}) => {
                return new Promise(async (resolve) => {
                    try {
                        // Создаем запрос
                        const api = await this.API(`search?type=all&text=${encodeURIComponent(query)}&page=0&nococrrect=false`);

                        // Обрабатываем ошибки
                        if (api instanceof Error) return resolve(api);
                        else if (!api.tracks) return resolve([]);

                        const tracks = api.tracks["results"].splice(0, limit).map(this.track);
                        return resolve(tracks);
                    } catch (e) {
                        return resolve(new Error(`[APIs]: ${e}`))
                    }
                });
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
     * @protected
     * @static
     */
    protected getAudio = (ID: string): Promise<string | Error> => {
        return new Promise<string | Error>(async (resolve) => {
            try {
                const api = await this.API(`tracks/${ID}/download-info`);

                // Если на этапе получение данных получена одна из ошибок
                if (!api) return resolve(locale.err("api.request.fail.msg", ["Fail getting audio file, api as 0"]));
                else if (api instanceof Error) return resolve(api);
                else if (api.length === 0) return resolve(locale.err("api.request.fail.msg", ["Fail getting audio file, api.size as 0"]));

                const url = api.find((data: any) => data.codec !== "aac");

                // Если нет ссылки на xml
                if (!url) return resolve(locale.err("api.request.fail.msg", ["Fail getting audio url"]));

                // Расшифровываем xml страницу на фрагменты
                new httpsClient({url: url["downloadInfoUrl"]}).toXML.then((xml) => {
                    if (xml instanceof Error) return resolve(xml);

                    const path = xml[1];
                    const sign = crypto.createHash("md5").update("XGRlBW9FXlekgbPrRHuSiA" + path.slice(1) + xml[4]).digest("hex");

                    return resolve(`https://${xml[0]}/get-mp3/${sign}/${xml[2]}${path}`);
                }).catch((e) => {
                    return resolve(Error(e));
                });
            } catch (e) {
                return resolve(Error(e as string));
            }
        });
    };

    /**
     * @description Расшифровываем картинку
     * @param image - Данные о картинке
     * @param size - Размер картинки
     * @protected
     * @static
     */
    protected parseImage = ({image, size = 1e3}: { image: string, size?: number }): {url: string, width?: number, height?: number} => {
        if (!image) return { url: "" };

        return {
            url: `https://${image.split("%%")[0]}m${size}x${size}`,
            width: size, height: size
        };
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

        return {
            id: `${album.id}_${track.id}`,
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image: this.parseImage({image: track?.["ogImage"] || track?.["coverUri"]}) ?? null,
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