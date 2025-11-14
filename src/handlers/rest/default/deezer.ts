import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestDeezerAPI
 * @public
 */
@DeclareRest({
    name: "DEEZER",
    color: 7419530,
    url: "www.deezer.com",
    audio: false,
    filter: /^(https?:\/\/)?(www\.)?(deezer\.com)\/.+$/i,
})
@OptionsRest({
    /**
     * @description Ссылка на метод API
     * @protected
     */
    api: "https://api.deezer.com"
})
class RestDeezerAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
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
                    const api = await this.API(`album/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;

                    const tracks = api.tracks.data.splice(0, limit);
                    const songs = tracks.map(this.track);

                    return {
                        url,
                        title: api.title,
                        items: songs,
                        image: api.cover_xl
                    };
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
            filter: /(playlist)\/[0-9]+/i,
            execute: async (url, {limit}) => {
                const ID = /[0-9]+/i.exec(url).pop();

                if (!ID) return locale.err("api.request.id.playlist");

                try {
                    // Создаем запрос
                    const api = await this.API(`playlist/${ID}`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    else if (api?.tracks?.data?.length === 0) return locale.err("api.request.fail.msg", ["Not found tracks in playlist"]);

                    const tracks: any[] = api.tracks.data?.splice(0, limit);
                    const songs = tracks.map(this.track);

                    return {
                        url,
                        title: api.title,
                        image: api.picture_xl,
                        items: songs,
                        artist: {
                            title: api.creator.name,
                            url: `https://${this.url}/${api.creator.type === "user" ? "profile" : "artist"}/${api.creator.id}`
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
                    const api = await this.API(`artist/${ID}/top`);

                    // Если запрос выдал ошибку то
                    if (api instanceof Error) return api;
                    return api.data.splice(0, limit).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
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
                    const api = await this.API(`search?q=${encodeURIComponent(query)}`);

                    // Обрабатываем ошибки
                    if (api instanceof Error) return api;
                    else if (!api.data) return [];

                    return api.data.splice(0, limit).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
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
                method: "GET",
            }).toJson.then((req) => {
                // Если на этапе получение данных получена одна из ошибок
                if (!req || req instanceof Error) return resolve(locale.err("api.request.fail"));
                return resolve(req);
            }).catch((err) => {
                return resolve(Error(`[APIs]: ${err}`));
            });
        });
    };

    /**
     * @description Из полученных данных подготавливаем трек для Audio<Queue>
     * @param track - Данные трека
     * @protected
     */
    protected track = (track: any) => {
        const author = track["artist"]?.length ? track["artist"]?.pop() : track["artist"];
        const album = track["album"]?.length ? track["album"][0] : track["album"];

        return {
            id: track.id,
            title: track?.title,
            image: track.cover_xl ?? track.album.cover_xl,
            url: `https://${this.url}/album/${album.id}/track/${track.id}`,
            time: { total: `${track["duration"]}` },

            artist: track.author ?? {
                title: author?.name,
                url: `https://${this.url}/artist/${author.id}`
            }
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestDeezerAPI];