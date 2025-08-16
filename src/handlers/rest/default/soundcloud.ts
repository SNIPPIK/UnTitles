import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSoundCloudAPI
 * @extends Assign
 * @public
 */
@DeclareRest({
    name: "SOUNDCLOUD",
    url: "soundcloud.com",
    color: 15105570,
    audio: true,
    auth: env.get("token.soundcloud", null),
    filter: /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/,
})
@OptionsRest({
    /**
     * @description Ссылка для работы API
     * @protected
     */
    api: "https://api-v2.soundcloud.com",
})
class RestSoundCloudAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /^https?:\/\/soundcloud\.com\/([\w-]+)\/?([\w-]+)(?:\?.*)?$/i,
            execute: (url, options) => {
                const fixed = url.split("?")[0];

                return new Promise(async (resolve) => {
                    try {
                        // Создаем запрос
                        const request = await this.API(`resolve?url=${fixed}`);

                        // Если запрос выдал ошибку то
                        if (request instanceof Error) return resolve(request);

                        const {api, ClientID} = request;

                        // Если был найден трек
                        if (api.kind === "track") {
                            const track = this.track(api);

                            // Если указано получение аудио
                            if (options.audio) {
                                if (api.media.transcodings) {
                                    // Расшифровываем аудио формат
                                    track.audio = await this.getFormat(api.media.transcodings, ClientID);
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
            filter: /sets\/[a-zA-Z0-9]+/i,
            execute: (url, {limit}) => {
                const fixed = url.split("?")[0];

                return new Promise(async (resolve) => {
                    try {
                        // Создаем запрос
                        const request = await this.API(`resolve?url=${fixed}`);

                        // Если запрос выдал ошибку то
                        if (request instanceof Error) return resolve(request);

                        const { api } = request;

                        // Если был найден плейлист
                        if (api.kind === "playlist") {
                            // Если SoundCloud нас обманул со ссылкой, есть нет <result>.tracks, то это просто трек!
                            if (!api.tracks) return resolve(null);

                            // Все доступные треки в плейлисте
                            const items = api.tracks.filter((i) => i["permalink_url"]).splice(0, limit).map(this.track);

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
            execute: (query, options) => {
                return new Promise(async (resolve) => {
                    try {
                        // Создаем запрос
                        const request = await this.API(`search/tracks?q=${encodeURIComponent(query)}&limit=${options.limit}`);

                        // Если запрос выдал ошибку то
                        if (request instanceof Error) return resolve(request);

                        const {api} = request;

                        const tracks = api.collection.filter((i) => i.user).map(this.track);
                        return resolve(tracks);
                    } catch (e) {
                        return resolve(new Error(`[APIs]: ${e}`))
                    }
                });
            }
        }
    ];

    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url - Ссылка на видео или ID видео
     * @protected
     * @static
     */
    protected API = (url: string): Promise<{api: json, ClientID: string} | Error> => {
        return new Promise(async (resolve) => {
            const result = await new httpsClient({
                url: `${this.options.api}/${url}&client_id=${this.auth}`,
            }).toJson;

            // Если возникает ошибка при получении страницы
            if (result instanceof Error) return resolve(locale.err("api.request.fail"));

            return resolve({
                api: result,
                ClientID: this.auth
            });
        });
    };

    /**
     * @description Проходим все этапы для получения ссылки на поток трека
     * @param formats - Зашифрованные форматы аудио
     * @param ClientID - ID клиента
     */
    protected getFormat = (formats: any[], ClientID: string): Promise<string> => {
        return new Promise<string>(async (resolve) => {
            const FilterFormats = formats.filter((d) => d.format.protocol === "progressive").pop() ?? formats[0];
            const EndFormat = await new httpsClient({url: `${FilterFormats.url}?client_id=${ClientID}`, userAgent: true}).toJson as json;

            return resolve(EndFormat.url);
        });
    }

    /**
     * @description Подготавливаем трек к отправке
     * @param track - Данные видео
     * @protected
     * @static
     */
    protected track = (track: json) => {
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