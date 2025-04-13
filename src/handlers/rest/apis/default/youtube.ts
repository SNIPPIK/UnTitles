import {RestAPIBase, RestAPI} from "@handler/rest/apis";
import {Worker} from "node:worker_threads";
import {httpsClient} from "@handler/rest";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Assign} from "@utils";
import path from "node:path";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestYouTubeAPI
 * @public
 */
class RestYouTubeAPI extends Assign<RestAPI> {
    /**
     * @description Тип расшифровки аудио ссылок
     * @readonly
     * @private
     */
    private static readonly _encoder = env.get("youtube.encoder");

    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestAPIBase = {
        name: "YOUTUBE",
        url: "youtube.com",
        color: 16711680
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor RestYouTubeAPI
     * @public
     */
    public constructor() {
        super({ ...RestYouTubeAPI._platform,
            audio: true,
            auth: true,
            filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/gi,

            requests: [
                /**
                 * @description Запрос данных об плейлисте
                 * @type "playlist"
                 */
                {
                    name: "playlist",
                    filter: /playlist\?list=[a-zA-Z0-9-_]+/gi,
                    execute: (url: string, {limit}) => {
                        const ID = url.match(/playlist\?list=[a-zA-Z0-9-_]+/gi).pop();
                        let artist = null;

                        return new Promise<Track.playlist | Error>(async (resolve) => {
                            try {
                            // Если ID плейлиста не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err("api.request.id.playlist"));

                            const api = await RestYouTubeAPI.API(`https://www.youtube.com/${ID}`)

                            // Если при запросе была получена ошибка
                            if (api instanceof Error) return resolve(api);

                            // Данные о плейлисте
                            const playlist = api["microformat"]["microformatDataRenderer"];

                            // Необработанные видео
                            const videos: any[] = api["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"];

                            // Все доступные видео в плейлисте
                            const items = videos.splice(0, limit).map(({playlistVideoRenderer}) => RestYouTubeAPI.track(playlistVideoRenderer));

                            // Раздел с данными автора
                            const author = api["sidebar"]["playlistSidebarRenderer"]["items"];

                            // Если авторов в плейлисте больше 1
                            if (author.length > 1) {
                                const authorData = author[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];

                                // Получаем истинные данные об авторе плейлиста
                                artist = await RestYouTubeAPI.getChannel({
                                    id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"],
                                    name: authorData.title["runs"][0].text
                                });
                            }

                            return resolve({
                                url, items,
                                title: playlist.title,
                                image: playlist.thumbnail["thumbnails"].pop(),
                                artist: artist ?? items.at(-1).artist
                            });
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
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
                    filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/,
                    execute: (url: string, options) => {
                        const ID = (/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/).exec(url)[0];

                        return new Promise<Track | Error>(async (resolve) => {
                            try {
                                // Если ID видео не удалось извлечь из ссылки
                                if (!ID) return resolve(locale.err("api.request.id.track"));

                                // Интеграция с утилитой кеширования
                                const cache = db.cache.get(`${RestYouTubeAPI._platform.url}/${ID}`);

                                // Если найден трек или похожий объект
                                if (cache && !options?.audio) return resolve(cache);

                                const api = await RestYouTubeAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&has_verified=1`);

                                /// Если при получении данных возникла ошибка
                                if (api instanceof Error) return resolve(api);

                                // Если указано получение аудио
                                if (options.audio) {
                                    // Расшифровываем аудио формат
                                    const format = await RestYouTubeAPI.extractFormat(url, api["streamingData"], api.html);

                                    // Если есть расшифровка ссылки видео
                                    if (format) api["videoDetails"]["format"] = {url: format["url"]};
                                }

                                // Класс трека
                                const track = RestYouTubeAPI.track(api["videoDetails"]);

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
                 * @description Запрос данных треков артиста
                 * @type "author"
                 */
                {
                    name: "author",
                    filter: /\/(channel)?(@)/gi,
                    execute: (url: string, {limit}) => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                let ID: string;

                                // Получаем истинное id канала
                                if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                                else ID = `channel/${url.split("channel/")[1]}`;

                                // Создаем запрос
                                const details = await RestYouTubeAPI.API(`https://www.youtube.com/${ID}/videos`);

                                if (details instanceof Error) return resolve(details);

                                const author = details["microformat"]["microformatDataRenderer"];
                                const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                                const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                                    ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, limit);

                                // Модифицируем видео
                                const videos = contents.map(({richItemRenderer}: any) => {
                                    const video = richItemRenderer?.content?.["videoRenderer"];

                                    return {
                                        url: `https://youtu.be/${video["videoId"]}`, title: video.title["runs"][0].text, duration: { full: video["lengthText"]["simpleText"] },
                                        author: { url: `https://www.youtube.com${ID}`, title: author.title }
                                    }
                                });

                                return resolve(videos);
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
                    execute: (url: string, {limit}): Promise<Track[] | Error> => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                // Создаем запрос
                                const details = await RestYouTubeAPI.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                // Если при получении данных возникла ошибка
                                if (details instanceof Error) return resolve(details);

                                // Найденные видео
                                const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                // Проверяем на наличие видео
                                if (vanilla_videos?.length === 0 || !vanilla_videos) return resolve(locale.err("api.request.fail"));

                                let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                let videos: Track[] = filtered_.map(({ videoRenderer }: any) => RestYouTubeAPI.track(videoRenderer));

                                return resolve(videos);
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
     * @description Получаем страницу и ищем на ней данные
     * @param url - Ссылка на видео или ID видео
     * @protected
     * @static
     */
    protected static API = (url: string): Promise<Error | json> => {
        return new Promise((resolve) => {
            // Если не надо использовать ключ, то используем систему поиска данных по странице
            new httpsClient(url, {
                useragent: true,
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, compress, deflate, br",
                }
            })
                // Получаем исходную страницу
                .toString

                // Получаем результат из Promise
                .then((api) => {
                    // Если возникает ошибка при получении страницы
                    if (api instanceof Error) return resolve(locale.err("api.request.fail"));

                    // Ищем данные на странице
                    const data = this.extractInitialDataResponse(api);

                    // Если возникает ошибка при поиске на странице
                    if (data instanceof Error) return resolve(data);

                    // Путь плеера (необходим для расшифровки)
                    const html5Player = /<script\s+src="([^"]+)"(?:\s+type="text\/javascript")?\s+name="player_ias\/base"\s*>|"jsUrl":"([^"]+)"/.exec(api);

                    return resolve(Object.assign(data, {
                        html: `https://www.youtube.com${html5Player ? html5Player[1] || html5Player[2] : null}`
                    }));
                })

                // Если происходит ошибка
                .catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем аудио дорожки
     * @param url - Ссылка на видео
     * @param data - <videoData>.streamingData все форматы видео, будет выбран оптимальный
     * @param html - Ссылка на html плеер
     * @protected
     * @static
     */
    protected static extractFormat = (url: string, data?: json, html?: string) => {
        return new Promise((resolve) => {
            // Если нет форматов
            if (!data["formats"]) return resolve(null);

            // Если расшифровка не требуется
            else if (data["formats"][0]?.url) return data["formats"][0];

            // Создаем 2 поток
            let worker: Worker = new Worker(path.resolve("src/services/worker/Signature/youtube.js"), {
                execArgv: ["-r", "tsconfig-paths/register"],
                workerData: null,
                resourceLimits: {
                    maxOldGenerationSizeMb: 20,
                    maxYoungGenerationSizeMb: 0
                }
            });

            // Отправляем сообщение во 2 поток
            worker.postMessage({html, url, formats: data["formats"], type: RestYouTubeAPI._encoder});

            // Слушаем ответ от 2 потока
            worker.once("message", (data) => {
                // Через время убиваем поток если он не нужен
                setImmediate(() => {
                    setTimeout(async () => {
                        await worker.terminate();
                        worker.ref()
                    }, 2e3)
                });

                return resolve(data);
            });

            // Если при создании получена ошибка
            worker.once("error", (err) => {
                // Через время убиваем поток если он не нужен
                setImmediate(() => {
                    setTimeout(async () => {
                        await worker.terminate();
                        worker.ref()
                    }, 2e3)
                });

                console.error(err);
                return resolve(err);
            });
            return;
        });
    };

    /**
     * @description Получаем данные из страницы
     * @param input - Страница
     */
    protected static extractInitialDataResponse = (input: string): json | Error => {
        const startPattern: string = input.match("var ytInitialPlayerResponse = ") ? "var ytInitialPlayerResponse = " : "var ytInitialData = ";
        const startIndex = input.indexOf(startPattern);
        const endIndex = input.indexOf("};", startIndex + startPattern.length);

        // Если нет данных
        if (startIndex === -1 && endIndex === -1)return locale.err("api.request.fail");

        const data = JSON.parse(input.substring(startIndex + startPattern.length, endIndex + 1));

        // Если при получении данных происходит что-то не так
        if (!data) return locale.err("api.request.fail");

        // Если есть статус, то проверяем
        if (data["playabilityStatus"]?.status) {
            if (data["playabilityStatus"]?.status === "LOGIN_REQUIRED") return Error(locale._(locale.language, "api.request.login"));
            else if (data["playabilityStatus"]?.status !== "OK") return Error(locale._(locale.language, "api.request.fail.msg", [data["playabilityStatus"]?.reason]));
        }

        // Выдаем данные
        return data;
    };

    /**
     * @description Получаем данные об авторе видео
     * @param id - ID канала
     * @param name - Название канала, если не будет найден канал будет возвращено название
     * @protected
     * @static
     */
    protected static getChannel = ({ id, name }: { id: string, name?: string }): Promise<Track.artist> => {
        return new Promise<Track.artist>((resolve) => {
            new httpsClient(`https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00"
                }
            }).toJson.then((channel) => {
                if (channel instanceof Error) return resolve(null);

                const data = channel[1]?.response ?? channel?.response ?? null as any;
                const info = data?.header?.["c4TabbedHeaderRenderer"], Channel = data?.metadata?.["channelMetadataRenderer"],
                    avatar = info?.avatar;

                return resolve({
                    title: Channel?.title ?? name ?? "Not found name",
                    url: `https://www.youtube.com/channel/${id}`,
                    image: avatar?.["thumbnails"].pop() ?? null
                });
            }).catch(() => resolve(null));
        });
    };

    /**
     * @description Подготавливаем трек к отправке
     * @param track - Данные видео
     * @protected
     * @static
     */
    protected static track = (track: json) => {
        try {
            return new Track({
                id: track["videoId"],
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title?.["runs"][0]?.text ?? track.title,
                artist: {
                    title: track["shortBylineText"]["runs"][0].text ?? track.author ?? undefined,
                    url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
                },
                time: { total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0 },
                image: {
                    url: `https://i.ytimg.com/vi/${track["videoId"]}/maxresdefault.jpg`
                },
                audio: track?.format?.url || undefined
            }, RestYouTubeAPI._platform);
        } catch {
            return new Track({
                id: track["videoId"],
                artist: {
                    title: track.author,
                    url: `https://www.youtube.com/channel/${track.channelId}`
                },
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title,
                time: {
                    total: track["lengthSeconds"] ?? 0
                },
                image: {
                    url: `https://i.ytimg.com/vi/${track["videoId"]}/maxresdefault.jpg`
                },
                audio: track?.format?.url || undefined
            }, RestYouTubeAPI._platform)
        }
    };
}


/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ RestYouTubeAPI });