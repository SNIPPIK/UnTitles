import {API, httpsClient} from "@handler/apis";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import crypto from "node:crypto";
import {Assign} from "@utils";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Assign<API> {
    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        /**
         * @description Ссылка на метод API
         * @protected
         */
        api: "https://api.music.yandex.net",

        /**
         * @description Токен для авторизации
         * @protected
         */
        token: env.get<string>("token.yandex", null)
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({
            name: "YANDEX",
            audio: true,
            auth: !!sAPI.authorization.token,

            color: 16705372,
            filter: /^(https?:\/\/)?(music\.)?(yandex\.ru)\/.+$/gi,
            url: "music.yandex.ru",

            requests: [
                /**
                 * @description Запрос данных о треке
                 * @type track
                 */
                {
                    name: "track",
                    filter: /track\/[0-9]+/gi,
                    execute: (url, options) => {
                        const ID = /track\/[0-9]+/gi.exec(url)[0]?.split("track")?.at(1);

                        return new Promise<Track | Error>(async (resolve) => {
                            // Если ID трека не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(ID);

                            // Если найден трек или похожий объект
                            if (cache && options?.audio) return resolve(cache);

                            try {
                                // Делаем запрос
                                const api = await sAPI.API(`tracks/${ID}`);

                                // Обрабатываем ошибки
                                if (api instanceof Error) return resolve(api);
                                else if (!api[0]) return resolve(locale.err( "api.request.fail"));

                                const track = sAPI.track(api[0]);
                                const link = await sAPI.getAudio(ID);

                                // Проверяем не получена ли ошибка при расшифровке ссылки на исходный файл
                                if (link instanceof Error) return resolve(link);
                                track.link = link;

                                // Сохраняем кеш в системе
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
                 * @type album
                 */
                {
                    name: "album",
                    filter: /(album)\/[0-9]+/gi,
                    execute: (url, {limit}) => {
                        const ID = /[0-9]+/gi.exec(url)?.at(0)?.split("album")?.at(0);

                        return new Promise<Track.playlist | Error>(async (resolve) => {
                            // Если ID альбома не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.album"));

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`albums/${ID}/with-tracks`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                else if (!api?.["duplicates"]?.length && !api?.["volumes"]?.length) return resolve(locale.err("api.request.fail"));

                                const AlbumImage = sAPI.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                                const tracks: Track.data[] = api["volumes"]?.pop().splice(0, limit);
                                const songs = tracks.map(sAPI.track);

                                return resolve({url, title: api.title, image: AlbumImage, items: songs});
                            } catch (e) {
                                return resolve(Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных об плейлисте
                 * @type playlist
                 */
                {
                    name: "playlist",
                    filter: /(users\/[a-zA-Z0-9]+).*(playlists\/[0-9]+)/gi,
                    execute: (url, {limit}) => {
                        const ID = /(users\/[a-zA-Z0-9]+).*(playlists\/[0-9]+)/gi.exec(url);

                        return new Promise<Track.playlist | Error>(async (resolve) => {
                            if (!ID[1]) return resolve(locale.err("api.request.id.author"));
                            else if (!ID[2]) return resolve(locale.err("api.request.id.playlist"));

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(ID[0]);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                else if (api?.tracks?.length === 0) return resolve(locale.err("api.request.fail.msg", ["Not found tracks in playlist"]));

                                const image = sAPI.parseImage({image: api?.["ogImage"] ?? api?.["coverUri"]});
                                const tracks: any[] = api.tracks?.splice(0, limit);
                                const songs = tracks.map(({track}) => sAPI.track(track));

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
                 * @type author
                 */
                {
                    name: "author",
                    filter: /(artist)\/[0-9]+/gi,
                    execute: (url, {limit}) => {
                        const ID = /(artist)\/[0-9]+/gi.exec(url)?.at(0)?.split("artist")?.at(0);

                        return new Promise<Track[] | Error>(async (resolve) => {
                            // Если ID автора не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err("api.request.id.author"));

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`artists/${ID}/tracks`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                const tracks = api.tracks.splice(0, limit).map(sAPI.track);

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
                    execute: (url , {limit}) => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`search?type=all&text=${url.split(" ").join("%20")}&page=0&nococrrect=false`);

                                // Обрабатываем ошибки
                                if (api instanceof Error) return resolve(api);
                                else if (!api.tracks) return resolve(locale.err("api.request.fail"));

                                const tracks = api.tracks["results"].splice(0, limit).map(sAPI.track);
                                return resolve(tracks);
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
     * @description Делаем запрос на {data.api}/methods
     * @param method - Метод запроса из api
     * @protected
     * @static
     */
    protected static API = (method: string): Promise<json> => {
        return new Promise<any | Error>((resolve) => {
            new httpsClient(`${this.authorization.api}/${method}`, {
                headers: {
                    "Authorization": "OAuth " + this.authorization.token
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
    protected static getAudio = (ID: string): Promise<string | Error> => {
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
                new httpsClient(url["downloadInfoUrl"]).toXML.then((xml) => {
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
    protected static parseImage = ({image, size = 1e3}: { image: string, size?: number }): {url: string, width?: number, height?: number} => {
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
    protected static track = (track: any): Track => {
        const author = track["artists"]?.length ? track["artists"]?.pop() : track["artists"];
        const album = track["albums"]?.length ? track["albums"][0] : track["albums"];

        return new Track({
            id: `${album.id}_${track.id}`,
            title: `${track?.title ?? track?.name}` + (track.version ? ` - ${track.version}` : ""),
            image: this.parseImage({image: track?.["ogImage"] || track?.["coverUri"]}) ?? null,
            url: `https://music.yandex.ru/album/${album.id}/track/${track.id}`,
            time: { total: (track["durationMs"] / 1000).toFixed(0) ?? "250" as any },

            artist: track.author ?? {
                title: author?.name,
                url: `https://music.yandex.ru/artist/${author.id}`,
                image: this.parseImage({image: author?.["ogImage"] ?? author?.["coverUri"]}) ?? null
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI });