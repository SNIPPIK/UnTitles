import { Assign, httpsClient, locale } from "#structures";
import type { RestServerSide } from "#handler/rest";
import { Worker } from "node:worker_threads";
import { Track } from "#core/queue";
import { db } from "#app/db";
import path from "node:path";
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
            filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/i,

            requests: [
                /**
                 * @description Запрос данных об плейлисте
                 * @type "playlist"
                 */
                {
                    name: "playlist",
                    filter: /playlist\?list=[a-zA-Z0-9-_]+/i,
                    execute: (url: string, {limit}) => {
                        const ID = url.match(/playlist\?list=[a-zA-Z0-9-_]+/i).pop();
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
                                const api = await RestYouTubeAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&has_verified=1`);
                                if (api instanceof Error) return api;

                                const related = api.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? [];
                                const relatedVideos = [];

                                // Подготавливаем данные треков (video)
                                for (const item of related) {
                                    const render = item.compactVideoRenderer || item.lockupViewModel;

                                    // Если не видео
                                    if (render?.contentType && render?.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' && !render?.rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId) continue;

                                    relatedVideos.push(RestYouTubeAPI.track({
                                        videoId: render?.rendererContext.commandContext.onTap.innertubeCommand.watchEndpoint.videoId,
                                        title: render?.rendererContext.accessibilityContext?.label ?? render?.metadata?.lockupMetadataViewModel.title.content,
                                        channelId: "null",
                                        lengthSeconds: "100",
                                        author: render?.metadata?.lockupMetadataViewModel.metadata?.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content.split(",")[0],
                                        format: { audio: null }
                                    }))
                                }

                                return resolve({
                                    url,
                                    items: relatedVideos,
                                    title: null,
                                    image: null,
                                    artist: null,
                                });
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`));
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

                                setImmediate(() => {
                                    // Сохраняем кеш в системе
                                    if (!cache) db.cache.set(track, RestYouTubeAPI._platform.url);
                                });

                                // Если указано получение аудио
                                if (options.audio) {
                                    // Если включена утилита кеширования
                                    if (db.cache.audio) {
                                        // Если есть кеш аудио
                                        if (db.cache.audio.status(`${RestYouTubeAPI._platform.url}/${ID}`).status === "ended") return resolve(track);
                                    }

                                    const data = api["streamingData"];

                                    // dashManifestUrl, hlsManifestUrl
                                    if (data["hlsManifestUrl"]) track.audio = data["hlsManifestUrl"];
                                    else {
                                        // Если нет форматов
                                        if (!data["formats"]) return resolve(locale.err("api.request.audio.fail", [RestYouTubeAPI._platform.name]));

                                        // Расшифровываем аудио формат
                                        const format = await RestYouTubeAPI.extractFormat(data, api.html, url);

                                        // Если есть расшифровка ссылки видео
                                        if (format) track.audio = format["url"];
                                    }
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
                    filter: /\/(channel)?(@)/i,
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
                                const details = await RestYouTubeAPI.API(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}&sp=QgIIAQ%3D%3D`);

                                // Если при получении данных возникла ошибка
                                if (details instanceof Error) return resolve(details);

                                // Найденные видео
                                const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                // Проверяем на наличие видео
                                if (vanilla_videos?.length === 0 || !vanilla_videos) return resolve(locale.err("api.request.fail"));

                                const filtered_ = vanilla_videos?.filter((video: json) => video && video?.["videoRenderer"])?.splice(0, limit);
                                const videos: Track.data[] = filtered_.map(({ videoRenderer }: json) => RestYouTubeAPI.track(videoRenderer));

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
            new httpsClient({
                url,
                userAgent: true,
                headers: {
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, compress, deflate, br"
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
     * @param data - <videoData>.streamingData все форматы видео, будет выбран оптимальный
     * @param html - Ссылка на html плеер
     * @param url - Ссылка на видео
     * @protected
     * @static
     */
    protected static extractFormat = async (data: json, html: string, url: string) => {
        // Если установлен wrapper
        if (fs.existsSync("node_modules/ytdlp-nodejs")) {
            const { YtDlp } = require("ytdlp-nodejs");
            const ytdlp = new YtDlp();

            const result = await ytdlp.getInfoAsync(url);
            return (result.requested_formats).find((format) => !format.fps)
        }

        // Запускаем мусорный Signature extractor, очень много мусора за собой оставляет
        return new Promise((resolve) => {
            // Создаем еще 1 поток, для выполнения мусорной функции
            const worker: Worker = new Worker(path.resolve("src/workers/YouTubeSignatureExtractor.js"), {
                execArgv: ["-r", "tsconfig-paths/register"],
                resourceLimits: {
                    maxOldGenerationSizeMb: 15,
                    maxYoungGenerationSizeMb: 10
                },
                workerData: null
            });

            // Отправляем сообщение во 2 поток
            worker.postMessage({formats: data["formats"], html});

            worker.once("exit", () => {
                setTimeout(async () => {
                    worker.removeAllListeners();
                    await worker.terminate();
                    worker.ref();
                }, 2e3);
            });

            // Слушаем ответ от 2 потока
            worker.once("message", (data) => {
                worker.emit("exit");
                return resolve(data);
            });

            // Если при создании получена ошибка
            worker.once("error", (err) => {
                worker.emit("exit");
                console.error(err);
                return resolve(err);
            });
        });
    };

    /**
     * @description Получаем данные из страницы
     * @param input - Страница
     */
    protected static extractInitialDataResponse = (input: string): json | Error => {
        if (typeof input !== "string") return locale.err("api.request.fail");

        let endData: json = {};

        // Попытка найти ytInitialData JSON
        const initialDataMatch = input.match(/var ytInitialData = (.*?);<\/script>/);
        if (initialDataMatch) {
            try {
                endData = JSON.parse(initialDataMatch[1]);
            } catch {
                // Игнорируем ошибку парсинга initialData
            }
        }

        // Определяем, какой паттерн искать дальше: playerResponse или initialData
        const startPattern = input.includes("var ytInitialPlayerResponse = ")
            ? "var ytInitialPlayerResponse = "
            : "var ytInitialData = ";

        const startIndex = input.indexOf(startPattern);
        const endIndex = input.indexOf("};", startIndex + startPattern.length);

        // Если не нашли нужный участок с JSON — возвращаем ошибку
        if (startIndex === -1 || endIndex === -1) return locale.err("api.request.fail");

        try {
            const jsonStr = input.substring(startIndex + startPattern.length, endIndex + 1);
            const parsedData = JSON.parse(jsonStr);
            // Объединяем данные, playerResponse имеет приоритет
            endData = { ...endData, ...parsedData };
        } catch {
            return locale.err("api.request.fail");
        }

        // Проверяем статус playabilityStatus, если есть
        const status = endData.playabilityStatus?.status;
        if (status) {
            if (status === "LOGIN_REQUIRED") {
                return new Error(locale._(locale.language, "api.request.login"));
            } else if (status !== "OK") {
                const reason = endData.playabilityStatus?.reason || "";
                return new Error(locale._(locale.language, "api.request.fail.msg", [reason]));
            }
        }

        return endData;
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
        const title = track.title?.simpleText ?? track.title?.["runs"]?.[0]?.text ?? track.title;
        const author = track["shortBylineText"]?.["runs"]?.[0]?.text ?? track.author;
        const id = track?.["videoId"] ?? track?.["inlinePlaybackEndpoint"]?.["watchEndpoint"]?.["videoId"] ?? track.contentId;

        try {
            return { title, id,
                url: `https://youtu.be/${id}`,
                artist: {
                    title: author,
                    url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
                },
                time: { total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0 },
                image: {
                    url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
                },
                audio: track?.format?.url || undefined
            };
        } catch {
            return { title, id,
                artist: {
                    title: author,
                    url: `https://www.youtube.com/channel/${track.channelId}`
                },
                url: `https://youtu.be/${id}`,
                time: {
                    total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0
                },
                image: {
                    url: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`
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