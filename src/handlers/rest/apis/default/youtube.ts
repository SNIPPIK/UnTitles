import {Youtube_decoder_native} from "#worker/YouTubeSignatureExtractor";
import type {RestServerSide} from "#handler/rest/apis";
import {httpsClient} from "#handler/rest";
import {locale} from "#service/locale";
import {Track} from "#service/player";
import {Assign} from "#utils";
import {db} from "#app/db";
import fs from "node:fs";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestYouTubeAPI
 * @public
 */
class RestYouTubeAPI extends Assign<RestServerSide.API> {
    /**
     * @description Данные для создания трека с этими данными
     * @protected
     * @static
     */
    protected static _platform: RestServerSide.APIBase = {
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
        super({...RestYouTubeAPI._platform,
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

                        return new Promise(async (resolve) => {
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
                 * @description Запрос треков из волны, для выполнения требуется указать list=RD в ссылке
                 * @type "wave"
                 */
                {
                    name: "wave",
                    filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})?(list=RD)/,
                    execute: (url) => {
                        return new Promise(async (resolve) => {
                            const ID = (/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/).exec(url)[0];

                            try {
                                const api = await RestYouTubeAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&has_verified=1`, 0);

                                // Если при получении данных возникла ошибка
                                if (api instanceof Error) return resolve(api);

                                const related = api.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? [];
                                const relatedVideos = [];

                                // Подготавливаем данные треков (video)
                                for (const item of related) {
                                    const videoRenderer = item.compactVideoRenderer;
                                    if (!videoRenderer || videoRenderer.lengthText?.simpleText.duration() > 400) continue;

                                    relatedVideos.push(RestYouTubeAPI.track(videoRenderer));
                                }

                                return resolve({
                                    url,
                                    items: relatedVideos,
                                    title: null,
                                    image: null,
                                    artist: null
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

                        return new Promise(async (resolve) => {
                            try {
                                // Если ID видео не удалось извлечь из ссылки
                                if (!ID) return resolve(locale.err("api.request.id.track"));

                                const cache = db.cache.get(`${RestYouTubeAPI._platform.url}/${ID}`);

                                // Если трек есть в кеше
                                if (cache) {
                                    if (!options.audio) return resolve(cache);

                                    // Если включена утилита кеширования аудио
                                    else if (db.cache.audio) {
                                        // Если есть кеш аудио
                                        if (db.cache.audio.status(`${RestYouTubeAPI._platform.url}/${ID}`).status === "ended") return resolve(cache);
                                    }
                                }

                                const api = await RestYouTubeAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&has_verified=1`);

                                // Если при получении данных возникла ошибка
                                if (api instanceof Error) return resolve(api);

                                // Класс трека
                                const track = RestYouTubeAPI.track(api["videoDetails"]);

                                // Сохраняем кеш в системе
                                if (!cache) await db.cache.set(track, RestYouTubeAPI._platform.url);

                                // Если указано получение аудио
                                if (options.audio) {
                                    // Если включена утилита кеширования
                                    if (db.cache.audio) {
                                        // Если есть кеш аудио
                                        if (db.cache.audio.status(`${RestYouTubeAPI._platform.url}/${ID}`).status === "ended") return resolve(track);
                                    }

                                    const data = api["streamingData"];

                                    // Если нет форматов
                                    if (!data["formats"]) return resolve(locale.err("api.request.audio.fail", [RestYouTubeAPI._platform.name]));

                                    // Расшифровываем аудио формат
                                    const format = await RestYouTubeAPI.extractFormat(data, api.html, url);

                                    // Если есть расшифровка ссылки видео
                                    if (format) track.audio = format["url"];
                                }

                                return resolve(track);
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`))
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
                    filter: /\/(channel)?(@)/gi,
                    execute: (url: string, {limit}) => {
                        return new Promise(async (resolve) => {
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
                    },
                },

                /**
                 * @description Запрос данных по поиску
                 * @type "search"
                 */
                {
                    name: "search",
                    execute: (query: string, {limit}) => {
                        return new Promise(async (resolve) => {
                            try {
                                // Создаем запрос
                                const details = await RestYouTubeAPI.API(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=EgIQAQ%3D%3D`);

                                // Если при получении данных возникла ошибка
                                if (details instanceof Error) return resolve(details);

                                // Найденные видео
                                const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                // Проверяем на наличие видео
                                if (vanilla_videos?.length === 0 || !vanilla_videos) return resolve(locale.err("api.request.fail"));

                                let filtered_ = vanilla_videos?.filter((video: json) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                let videos: Track.data[] = filtered_.map(({ videoRenderer }: json) => RestYouTubeAPI.track(videoRenderer));

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
     * @param pattern - Условие получения ytInitialData
     * @protected
     * @static
     */
    protected static API = (url: string, pattern = 1): Promise<Error | json> => {
        return new Promise((resolve) => {
            // Если не надо использовать ключ, то используем систему поиска данных по странице
            new httpsClient({
                url,
                userAgent: true,
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, compress, deflate, br"
                }
            })
                // Получаем исходную страницу
                .send()

                // Получаем результат из Promise
                .then((api) => {
                    // Если возникает ошибка при получении страницы
                    if (api instanceof Error) return resolve(locale.err("api.request.fail"));

                    // Ищем данные на странице
                    const data = this.extractInitialDataResponse(api, pattern);

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
     * @param data - <videoData>.streamingData все форматы видео, будет выбран оптимальный
     * @param html - Ссылка на html плеер
     * @param url - Ссылка на видео
     * @protected
     * @static
     */
    protected static extractFormat = async (data: json, html: string, url: string) => {
        // Если установлен wrapper
        if (fs.existsSync("node_modules/ytdlp-nodejs")) {
            const {YtDlp} = require("ytdlp-nodejs");
            const ytdlp = new YtDlp();

            const result = await ytdlp.getInfoAsync(url);
            return (result.requested_formats).find((format) => !format.fps)
        }

        const formats = await Youtube_decoder_native.decipherFormats(data["formats"], html);
        return formats[0];
    };

    /**
     * @description Получаем данные из страницы
     * @param input - Страница
     * @param pattern - Условие получения ytInitialData
     */
    protected static extractInitialDataResponse = (input: string, pattern: number = 1): json | Error => {
        if (pattern === 0) {
            const initialDataMatch = input.match(/var ytInitialData = (.*?);<\/script>/);
            if (!initialDataMatch) return [];

            let initialData: Error | json;
            try {
                initialData = JSON.parse(initialDataMatch[1]);
            } catch (e) {
                return null;
            }

            return initialData;
        }

        const startPattern: string = input.match("var ytInitialPlayerResponse = ") ? "var ytInitialPlayerResponse = " : "var ytInitialData = ";
        const startIndex = input.indexOf(startPattern);
        const endIndex = input.indexOf("};", startIndex + startPattern.length);

        // Если нет данных
        if (startIndex === -1 && endIndex === -1) return locale.err("api.request.fail");

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
            new httpsClient({
                url: `https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`,
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00"
                }
            }).send().then((channel) => {
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
            return {
                id: track["videoId"],
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title?.simpleText ?? track.title?.["runs"][0]?.text ?? track.title,
                artist: {
                    title: track["shortBylineText"]["runs"][0].text ?? track.author ?? undefined,
                    url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
                },
                time: { total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0 },
                image: {
                    url: `https://i.ytimg.com/vi/${track["videoId"]}/maxresdefault.jpg`
                },
                audio: track?.format?.url || undefined
            };
        } catch {
            return {
                id: track["videoId"],
                artist: {
                    title: track.author,
                    url: `https://www.youtube.com/channel/${track.channelId}`
                },
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title ?? track.title?.simpleText,
                time: {
                    total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0
                },
                image: {
                    url: `https://i.ytimg.com/vi/${track["videoId"]}/maxresdefault.jpg`
                },
                audio: track?.format?.url || undefined
            }
        }
    };
}


/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestYouTubeAPI];