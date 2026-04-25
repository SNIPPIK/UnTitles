import { DeclareRest, OptionsRest, RestServerSide } from "#handler/rest/index.js";
import { httpsClient, locale } from "#structures";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой SoundCloud, динамический плагин
 * # Types
 * - Track - Любой трек с платформы. Не получится получить платные видео или 18+
 * - Playlist - Любой открытый плейлист.
 * - Search - Поиск треков, пока не доступны плейлисты, альбомы, авторы
 * @Specification Rest SC API
 * @Audio Доступно нативное получение
 */

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestSoundCloudAPI
 * @extends RestServerSide
 * @public
 */
@DeclareRest({
    name: "SOUNDCLOUD",
    url: "soundcloud.com",
    color: 15105570,
    audio: true,
    auth: false,
    filter: /^(?:(https?):\/\/)?(?:(?:www|m)\.)?(api\.soundcloud\.com|soundcloud\.com|snd\.sc)\/(.*)$/,
})
@OptionsRest({
    /**
     * @description Ссылка для работы API
     * @protected
     */
    api: "https://api-v2.soundcloud.com",

    /**
     * @description Время жизни токена
     * @protected
     */
    time: 0,

    /**
     * @description Токен авторизации
     * @protected
     */
    client_id: null
})
class RestSoundCloudAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных о треке
         * @type "track"
         * @private
         */
        {
            name: "track",
            filter: /^https?:\/\/soundcloud\.com\/([\w-]+)\/?([\w-]+)(?:\?.*)?$/i,
            execute: async (url, { audio }) => {
                const fixed = url.split("?")[0];

                try {
                    // Создаем запрос
                    const request = await this.API(`resolve?url=${fixed}`);

                    // Если запрос выдал ошибку то
                    if (request instanceof Error) return request;

                    const { api, ClientID } = request;

                    // Если был найден трек
                    if (api.kind === "track") {
                        const track = this.track(api);

                        // Если указано получение аудио
                        if (audio) {
                            // Если трек не доступен к загрузке
                            if (!api.streamable) {
                                return new Error("Resource is not available in your country");
                            }

                            // Если есть данные для получения истинного аудио
                            else if (api.media.transcodings) {
                                // Расшифровываем аудио формат
                                track.audio = await this.getFormat(api.media.transcodings, ClientID);
                            }
                        }

                        return track;
                    }

                    return null;
                } catch (e) {
                    return new Error(`[APIs/track]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "playlist"
         * @private
         */
        {
            name: "playlist",
            filter: /sets\/[a-zA-Z0-9]+/i,
            execute: async (url, { limit }) => {
                const fixed = url.split("?")[0];

                try {
                    // Создаем запрос
                    const request = await this.API(`resolve?url=${fixed}`);

                    // Если запрос выдал ошибку то
                    if (request instanceof Error) return request;

                    const { api } = request;

                    // Если был найден плейлист
                    if (api.kind === "playlist") {
                        // Если SoundCloud нас обманул со ссылкой, есть нет <result>.tracks, то это просто трек!
                        if (!api.tracks) return null;

                        // Все доступные треки в плейлисте
                        const items = api.tracks.filter((i) => i["permalink_url"]).splice(0, limit).map(this.track);

                        return {
                            url,
                            title: api.title,
                            artist: {
                                url: api.user.permalink_url,
                                title: api.user.username,
                                image: api.user.avatar_url,
                            },
                            image: api.artwork_url,
                            items
                        };
                    }
                    return null;
                } catch (e) {
                    return new Error(`[APIs/playlist]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "search"
         */
        {
            name: "search",
            execute: async (query, options) => {
                try {
                    // Создаем запрос
                    const request = await this.API(`search/tracks?q=${encodeURIComponent(query)}&limit=${options.limit}`);

                    // Если запрос выдал ошибку то
                    if (request instanceof Error) return request;

                    const { api } = request;

                    return api.collection.filter((i) => i.user).map(this.track);
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        }
    ];

    /**
     * @description Получаем страницу и ищем на ней данные
     * @param url - Ссылка на видео или ID видео
     * @protected
     */
    protected API = (url: string): Promise<{api: json, ClientID: string} | Error> => {
        return new Promise(async (resolve) => {
            const ClientID = await this.authorization();

            // Если client_id не был получен
            if (ClientID instanceof Error) return resolve(ClientID);
            else if (!ClientID) return resolve(Error("[API] Fail getting client ID"));

            const result = await new httpsClient({
                url: `${this.options.api}/${url}&client_id=${ClientID}`,
                userAgent: true,
                agent: this.agent
            }).toJson;

            // Если возникает ошибка при получении страницы
            if (result instanceof Error) return resolve(locale.err("api.request.fail"));

            return resolve({
                api: result,
                ClientID: ClientID
            });
        });
    };

    /**
     * @description Получаем временный client_id для SoundCloud
     * @protected
     */
    protected authorization = async (): Promise<string | Error> => {
        // Если client_id ещё действителен, возвращаем его
        if (this.options.client_id && this.options.time > Date.now()) return this.options.client_id;

        try {
            const parsedPage = await new httpsClient({
                url: `https://${this.url}/`,
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
                },
                agent: this.agent
            }).toString;

            if (parsedPage instanceof Error) return parsedPage;
            else if (!parsedPage) return null;

            const soundCLD: any[] = JSON.parse(parsedPage.split(/<script>window.__sc_hydration = /gi)[1].split(";</script>")[0]);

            // Ищем истинный ID
            const client_id = soundCLD.find((i) => i.hydratable === "apiClient");

            // Если нет ID
            if (!client_id || !client_id.data || !client_id.data.id) return null;

            this.options.client_id = client_id.data.id;
            this.options.time = Date.now() + 60 * 30 * 1e3;

            // Выдаем анонимный ID
            return client_id.data.id;
        } catch (err) {
            console.error("Error fetching client_id:", err);
            return null;
        }
    };

    /**
     * @description Проходим все этапы для получения ссылки на поток трека
     * @param formats - Зашифрованные форматы аудио
     * @param ClientID - ID клиента
     * @protected
     */
    protected getFormat = (formats: any[], ClientID: string): Promise<string> => {
        return new Promise<string>(async (resolve) => {
            const FilterFormats = formats.filter((d) => d.format.protocol === "progressive").pop() ?? formats[0];
            const EndFormat = await new httpsClient({
                url: `${FilterFormats.url}?client_id=${ClientID}`,
                userAgent: true,
                agent: this.agent
            }).toJson as json;

            return resolve(EndFormat.url);
        });
    };

    /**
     * @description Подготавливаем трек к отправке
     * @param track - Данные видео
     * @protected
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
            image: track.artwork_url?.replace("large", "t500x500"),
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