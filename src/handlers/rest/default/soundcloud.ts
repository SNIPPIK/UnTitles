import { Assign, httpsClient } from "#structures";
import { RestServerSide } from "#handler/rest";
import { locale } from "#service/locale";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSoundCloudAPI
 * @extends Assign
 * @public
 */
class RestSoundCloudAPI extends Assign<RestServerSide.API> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestServerSide.APIBase = {
        name: "SOUNDCLOUD",
        url: "soundcloud.com",
        color: 15105570
    };

    /**
     * @description Данные для создания запросов
     * @protected
     */
    protected static authorization = {
        /**
         * @description Ссылки для работы API
         * @protected
         */
        urls: {
            api: "https://api-v2.soundcloud.com",
        },

        /**
         * @description Данные для авторизации
         * @protected
         */
        token: env.get("token.soundcloud", null),
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor RestSoundCloudAPI
     * @public
     */
    public constructor() {
        super({
            ...RestSoundCloudAPI._platform,
            audio: true,
            auth: !!RestSoundCloudAPI.authorization.token,
            filter: /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/,

            requests: [
                /**
                 * @description Запрос данных о треке
                 * @type "track"
                 */
                {
                    name: "track",
                    filter: /^https?:\/\/soundcloud\.com\/([\w-]+)\/?([\w-]+)(?:\?.*)?$/i, // https://soundcloud.com/neffexmusic/neffex-save-a-life-
                    execute: (url: string, options) => {
                        const fixed = url.split("?")[0];

                        return new Promise(async (resolve) => {
                            try {
                                // Создаем запрос
                                const request = await RestSoundCloudAPI.API(`resolve?url=${fixed}`);

                                // Если запрос выдал ошибку то
                                if (request instanceof Error) return resolve(request);

                                const {api, ClientID} = request;

                                // Если был найден трек
                                if (api.kind === "track") {
                                    const track = RestSoundCloudAPI.track(api);

                                    // Если указано получение аудио
                                    if (options.audio) {
                                        if (api.media.transcodings) {
                                            // Расшифровываем аудио формат
                                            track.audio = await RestSoundCloudAPI.getFormat(api.media.transcodings, ClientID);
                                        }
                                    }

                                    return resolve(track);
                                }
                                return resolve(null);
                            } catch (e) {
                                return resolve(new Error(`[APIs/track]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных о треке
                 * @type "playlist"
                 */
                {
                    name: "playlist",
                    filter: /sets\/[a-zA-Z0-9]+/gi, // https://soundcloud.com/neffexmusic/neffex-save-a-life-
                    execute: (url: string, {limit}) => {
                        const fixed = url.split("?")[0];

                        return new Promise(async (resolve) => {
                            try {
                                // Создаем запрос
                                const request = await RestSoundCloudAPI.API(`resolve?url=${fixed}`);

                                // Если запрос выдал ошибку то
                                if (request instanceof Error) return resolve(request);

                                const { api } = request;

                                // Если был найден плейлист
                                if (api.kind === "playlist") {
                                    // Если SoundCloud нас обманул со ссылкой, есть нет <result>.tracks, то это просто трек!
                                    if (!api.tracks) return resolve(null);

                                    // Все доступные треки в плейлисте
                                    const items = api.tracks.filter((i) => i["permalink_url"]).splice(0, limit).map(RestSoundCloudAPI.track);

                                    return resolve({
                                        url,
                                        title: api.title,
                                        artist: {
                                            url: api.user.permalink_url,
                                            title: api.user.username,
                                            image: api.user.avatar_url,
                                        },
                                        image: api.artwork_url,
                                        items
                                    });
                                }
                                return resolve(null);
                            } catch (e) {
                                return resolve(new Error(`[APIs/playlist]: ${e}`))
                            }
                        });
                    }
                },

                /**
                 * @description Запрос данных о треке
                 * @type "search"
                 */
                {
                    name: "search",
                    execute: (query: string, options) => {
                        return new Promise(async (resolve) => {
                            try {
                                // Создаем запрос
                                const request = await RestSoundCloudAPI.API(`search/tracks?q=${encodeURIComponent(query)}&limit=${options.limit}`);

                                // Если запрос выдал ошибку то
                                if (request instanceof Error) return resolve(request);

                                const {api} = request;

                                const tracks = api.collection.filter((i) => i.user).map(RestSoundCloudAPI.track);
                                return resolve(tracks);
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
                            }
                        });
                    }
                },
            ]
        });
    };

    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url - Ссылка на видео или ID видео
     * @protected
     * @static
     */
    protected static API = (url: string): Promise<{api: json, ClientID: string} | Error> => {
        return new Promise(async (resolve) => {
            const result = await new httpsClient({
                url: `${this.authorization.urls.api}/${url}&client_id=${this.authorization.token}`,
                userAgent: true,
            }).send() as json;

            // Если возникает ошибка при получении страницы
            if (result instanceof Error) return resolve(locale.err("api.request.fail"));

            return resolve({
                api: result,
                ClientID: this.authorization.token
            });
        });
    };

    /**
     * @description Проходим все этапы для получения ссылки на поток трека
     * @param formats - Зашифрованные форматы аудио
     * @param ClientID - ID клиента
     */
    protected static getFormat = (formats: any[], ClientID: string): Promise<string> => {
        return new Promise<string>(async (resolve) => {
            const FilterFormats = formats.filter((d) => d.format.protocol === "progressive").pop() ?? formats[0];
            const EndFormat = await new httpsClient({url: `${FilterFormats.url}?client_id=${ClientID}`}).send() as json;

            return resolve(EndFormat.url);
        });
    }

    /**
     * @description Подготавливаем трек к отправке
     * @param track - Данные видео
     * @protected
     * @static
     */
    protected static track = (track: json) => {
        return {
            id: track.id,
            url: track.permalink_url,
            title: track.title,
            artist: {
                url: track.user.permalink_url,
                title: track.user.username,
                image: track.user.avatar_url,
            },
            image: {
                url: track.artwork_url
            },
            time: {
                total: (track.duration / 1e3).toFixed(0)
            },
            audio: null,
        };
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestSoundCloudAPI];