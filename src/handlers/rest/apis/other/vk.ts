import {RestAPIBase, RestAPI} from "@handler/rest/apis";
import {httpsClient} from "@handler/rest";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Assign} from "@utils";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestVKAPI
 * @public
 */
class RestVKAPI extends Assign<RestAPI> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestAPIBase = {
        name: "VK",
        color: 30719,
        url: "vk.com",
    };

    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        /**
         * @description Ссылка на метод API
         * @protected
         */
        api: "https://api.vk.com/method",

        /**
         * @description Токен для авторизации
         * @protected
         */
        token: env.get("token.vk", null)
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor RestVKAPI
     * @public
     */
    public constructor() {
        super({...RestVKAPI._platform,
            audio: true,
            auth: !!RestVKAPI.authorization.token,
            filter: /^(https?:\/\/)?(vk\.com)\/.+$/gi,

            requests: [
                /**
                 * @description Запрос данных о треке
                 * @type "track"
                 */
                {
                    name: "track",
                    filter: /(audio)([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/gi,
                    execute: (url, options) => {
                        const ID = /([0-9]+_[0-9]+_[a-zA-Z0-9]+|-[0-9]+_[a-zA-Z0-9]+)/gi.exec(url).pop();

                        return new Promise<Track | Error>(async (resolve) => {
                            //Если ID трека не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(`${RestVKAPI._platform.url}/${ID}`);

                            // Если найден трек или похожий объект
                            if (cache && !options?.audio) return resolve(cache);

                            try {
                                // Создаем запрос
                                const api = await RestVKAPI.API("audio", "getById", `&audios=${ID}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);

                                const track = RestVKAPI.track(api.response.pop(), url);

                                // Если включена утилита кеширования
                                if (db.cache.audio) {
                                    // Если есть кеш аудио
                                    if (db.cache.audio.status(track).status === "ended") return resolve(track);
                                }

                                // Если нет ссылки на трек
                                else if (!track.link) return resolve(locale.err( "api.request.fail"));

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
                 * @description Запрос данных по поиску
                 * @type "search"
                 */
                {
                    name: "search",
                    execute: (url, {limit}) => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                // Создаем запрос
                                const api = await RestVKAPI.API("audio", "search", `&q=${url}`);

                                // Если запрос выдал ошибку то
                                if (api instanceof Error) return resolve(api);
                                const tracks = (api.response.items.splice(0, limit)).map((track: any) => RestVKAPI.track(track));

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
     * @description Делаем запрос к VK API
     * @param method {string} Метод, к примеру audio.getById (где audio метод, getById тип)
     * @param type {string} Тип запроса
     * @param options {string} Параметры через &
     * @protected
     * @static
     */
    protected static API = (method: "audio" | "execute" | "catalog", type: "getById" | "search" | "getPlaylistById", options: string): Promise<json | Error> => {
        return new Promise((resolve) => {
            const url = `${this.authorization.api}/${method}.${type}` + `?access_token=${this.authorization.token}${options}&v=5.95`;

            new httpsClient(url).toJson.then((api: any) => {
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
    protected static track = (track: json, url: string = null): Track => {
        const image = track?.album?.["thumb"];

        return new Track({
            id: `${track.owner_id}_${track.id}`,
            url: url || `https://vk.com/audio${track.owner_id}_${track.id}`,
            title: track.title,
            artist: this.author(track),
            image: { url: image?.["photo_1200"] ?? image?.["photo_600"] ?? image?.["photo_300"] ?? image?.["photo_270"] ?? undefined },
            time: { total: track.duration.toFixed(0) },
            audio: track?.url
        }, RestVKAPI._platform);
    };

    /**
     * @description Из полученных данных подготавливаем данные об авторе для ISong.track
     * @param user {any} Любой автор трека
     * @protected
     * @static
     */
    protected static author = (user: any): Track.artist => {
        const url = `https://vk.com/audio?performer=1&q=${user.artist.replaceAll(" ", "").toLowerCase()}`;

        return { url, title: user.artist };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI: RestVKAPI });