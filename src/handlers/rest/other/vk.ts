import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { Track } from "#core/queue";
import { env } from "#app/env";
import { db } from "#app/db";

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
    auth: env.get("token.vk", null),
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
            filter: /(audio)([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/i,
            execute: (url, options) => {
                const ID = /([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/i.exec(url).pop();

                return new Promise(async (resolve) => {
                    //Если ID трека не удалось извлечь из ссылки
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
                        // Создаем запрос
                        const api = await this.API("audio", "getById", `&audios=${ID}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);

                        const track = this.track(api.response.pop(), url);

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

                        // Если нет ссылки на трек
                        if (!track.audio) return resolve(locale.err( "api.request.fail"));

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
         * @description Запрос данных по поиску
         * @type "search"
         */
        {
            name: "search",
            execute: (query, {limit}) => {
                return new Promise(async (resolve) => {
                    try {
                        // Создаем запрос
                        const api = await this.API("audio", "search", `&q=${encodeURIComponent(query)}`);

                        // Если запрос выдал ошибку то
                        if (api instanceof Error) return resolve(api);
                        const tracks = (api.response.items.splice(0, limit)).map(this.track);

                        return resolve(tracks);
                    } catch (e) {
                        return resolve(new Error(`[APIs]: ${e}`))
                    }
                });
            }
        }
    ];

    /**
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     * @protected
     * @static
     */
    protected API = (method: "audio" | "execute" | "catalog", type: "getById" | "search" | "getPlaylistById", options: string): Promise<json | Error> => {
        return new Promise((resolve) => {
            const url = `${this.options.api}/${method}.${type}` + `?access_token=${this.auth}${options}&v=5.95`;

            new httpsClient({
                url
            }).toJson.then((api: any) => {
                // Если на этапе получение данных получена одна из ошибок
                if (!api || !api?.response) return resolve(locale.err( "api.request.fail"));
                else if (api?.["error_code"] || api?.error) return resolve(locale.err( "api.request.fail.msg", [api?.["error_msg"]]));

                return resolve(api);
            }).catch((err) => {
                return resolve(Error(`[APIs]: ${err}`));
            });
        });
    };

    /**
     * @description Из полученных данных подготавливаем трек для Audio<Queue>
     * @param track {any} Любой трек из VK
     * @param url - Ссылка на трек
     * @protected
     * @static
     */
    protected track = (track: json, url: string = null) => {
        const image = track?.album?.["thumb"];

        return {
            id: `${track.owner_id}_${track.id}`,
            url: url || `https://vk.com/audio${track.owner_id}_${track.id}`,
            title: track.title,
            artist: this.author(track),
            image: { url: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined },
            time: { total: track.duration.toFixed(0) },
            audio: track?.url
        };
    };

    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     * @protected
     * @static
     */
    protected author = (user: any): Track.artist => {
        const url = `https://vk.com/audio?performer=1&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestVKAPI];