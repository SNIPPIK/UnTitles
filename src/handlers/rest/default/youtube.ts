import {DeclareRest, OptionsRest, RestServerSide} from "#handler/rest";
import { httpsClient, locale } from "#structures";
import { Track } from "#core/queue";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Все допустимые заголовки
 * @const Clients
 */
const Clients = {
    /**
     * @description Запрос страницы, требуется указывать время для правильного запроса
     * @audio true - without sig
     */
    "ANDROID": {
        request: {
            cpn: generateClientPlaybackNonce(16),
            context: {
                client: {
                    clientName: "ANDROID",
                    clientVersion: "19.44.38",
                    platform: "MOBILE",
                    osName: "Android",
                    osVersion: "11",
                    androidSdkVersion: "30",
                    hl: "en",
                    gl: "US",
                    utcOffsetMinutes: -240,
                },
                request: {
                    internalExperimentFlags: [],
                    useSsl: true,
                },
                user: {
                    lockedSafetyMode: false,
                },
                "contentPlaybackContext": {
                    "html5Preference": "HTML5_PREF_WANTS"
                }
            },
            contentCheckOk: true,
            racyCheckOk: true
        },
        headers: {
            "Content-Type": "application/json",
            "User-Agent": `com.google.android.youtube/19.44.38 (Linux; U; Android 11) gzip`,
            "X-Goog-Api-Format-Version": "2"
        }
    },

    /**
     * @description Запрос страницы, требуется указывать время для правильного запроса
     * @audio true - without sig
     */
    "IOS": {
        request: {
            cpn: generateClientPlaybackNonce(16),
            contentCheckOk: true,
            racyCheckOk: true,
            context: {
                client: {
                    clientName: "IOS",
                    clientVersion: "19.45.4",
                    deviceMake: "Apple",
                    deviceModel: "iPhone16,2",
                    platform: "MOBILE",
                    osName: "iOS",
                    osVersion: "17.5.1.21F90",
                    hl: "en",
                    gl: "US",
                    utcOffsetMinutes: -240,
                },
                request: {
                    internalExperimentFlags: [],
                    useSsl: true,
                },
                user: {
                    lockedSafetyMode: false,
                },
            }
        },
        headers: {
            "Content-Type": "application/json",
            "User-Agent": `com.google.ios.youtube/19.45.4(iPhone16,2; U; CPU iOS 17_5_1 like Mac OS X; en_US)`,
            "X-Goog-Api-Format-Version": "2",
        }
    },

    /**
     * @description Запрос страницы, требуется указывать время для правильного запроса
     * @audio true
     */
    "WEB": {
        request: {
            "context": {
                "client": {
                    "hl": "en",
                    "gl": "US",
                    "clientName": "WEB",
                    "clientVersion": "2.20250927.00.00"
                }
            }
        }
    },

    /**
     * @description Запрос страницы урезанной
     * @audio false
     */
    "WEB_EMBEDDED": {
        request: {
            "context": {
                client: {
                    clientName: "WEB_EMBEDDED_PLAYER",
                    clientVersion: "1.20240723.01.00",
                    hl: "en",
                    timeZone: "UTC",
                    utcOffsetMinutes: 0
                }
            }
        }
    }
};

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class RestYouTubeAPI
 * @public
 */
@DeclareRest({
    name: "YOUTUBE",
    url: "youtube.com",
    filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/i,
    audio: true,
    color: 16711680
})
@OptionsRest({
    AIzaKey: generateFakeApiKey(),
    //@ts-ignore
    detect_is_bot: [] as keyof typeof Clients,
})
class RestYouTubeAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных об плейлисте
         * @type "playlist"
         */
        {
            name: "playlist",
            filter: /playlist\?list=[a-zA-Z0-9-_]+/i,
            execute: async (url, { limit }) => {
                const ID = url.match(/playlist\?list=[a-zA-Z0-9-_]+/i).pop();
                let artist = null;

                try {
                    // Если ID плейлиста не удалось извлечь из ссылки
                    if (!ID) return locale.err("api.request.id.playlist");

                    const api = await this.pAPI(`https://${this.url}/${ID}`)

                    // Если при запросе была получена ошибка
                    if (api instanceof Error) return api;

                    // Данные о плейлисте
                    const playlist = api["microformat"]["microformatDataRenderer"];

                    // Необработанные видео
                    const videos: any[] = api["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                        .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"];

                    // Все доступные видео в плейлисте
                    const items = videos.splice(0, limit).map(({playlistVideoRenderer}) => this.track(playlistVideoRenderer));

                    // Раздел с данными автора
                    const author = api["sidebar"]["playlistSidebarRenderer"]["items"];

                    // Если авторов в плейлисте больше 1
                    if (author.length > 1) {
                        const authorData = author[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];

                        // Получаем истинные данные об авторе плейлиста
                        artist = await this.getChannel({
                            id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"],
                            name: authorData.title["runs"][0].text
                        });
                    }

                    return {
                        url, items,
                        title: playlist.title,
                        image: playlist.thumbnail["thumbnails"].pop(),
                        artist: artist ?? items.at(-1).artist
                    };
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос треков из волны, для выполнения требуется указать list=RD в ссылке
         * @type "related"
         */
        {
            name: "related",
            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})?(list=RD)/,
            execute: async (url) => {
                const ID = (/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/).exec(url)[0];

                try {
                    const api = await this.pAPI(`https://${this.url}/watch?v=${ID}&hl=en&has_verified=1`);
                    if (api instanceof Error) return api;

                    const related = api.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results ?? [];
                    const relatedVideos = [];

                    // Подготавливаем данные треков (video)
                    for (const item of related) {
                        const render = item.compactVideoRenderer || item.lockupViewModel;

                        // Если есть недопустимые типы контента
                        if (!render?.contentType || render?.contentType !== "LOCKUP_CONTENT_TYPE_VIDEO") continue;

                        const title = render?.rendererContext.accessibilityContext?.label ?? render?.metadata?.lockupMetadataViewModel.title.content;
                        const duration = (title as string).duration();

                        // Если время слишком много
                        if (duration > 800 && !title.match(/album|ALBUM|Album/)) continue;

                        relatedVideos.push(this.track({
                            videoId: render.contentId,
                            title: render?.metadata?.lockupMetadataViewModel.title.content,
                            channelId: "null",
                            lengthSeconds: duration.duration(),
                            author: render?.metadata?.lockupMetadataViewModel.metadata?.contentMetadataViewModel.metadataRows[0].metadataParts[0].text.content.split(",")[0],
                            format: {audio: null}
                        }));
                    }

                    return {
                        url,
                        items: relatedVideos,
                        title: null,
                        image: null,
                        artist: null,
                    };
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "track"
         */
        {
            name: "track",
            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/,
            execute: async (url: string, options) => {
                const ID = (/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/).exec(url)[0];

                try {
                    // Если ID видео не удалось извлечь из ссылки
                    if (!ID) return locale.err("api.request.id.track");

                    const cache = db.cache.get(`${this.url}/${ID}`);

                    // Если трек есть в кеше
                    if (cache) {
                        if (!options.audio) return cache;

                        // Если включена утилита кеширования аудио
                        else if (db.cache.audio) {
                            const check = db.cache.audio.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                cache.audio = check.path;
                                return cache;
                            }
                        }
                    }

                    const api = await this.API(ID, options.audio);

                    // Если при получении данных возникла ошибка
                    if (api instanceof Error) return api;

                    // Класс трека
                    const track = this.track(api["videoDetails"]);

                    // Если указано получение аудио
                    if (options.audio) {
                        // Если включена утилита кеширования
                        if (db.cache.audio) {
                            const check = db.cache.audio.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                track.audio = check.path;
                                return track;
                            }
                        }

                        const data = api["streamingData"];

                        // dashManifestUrl, hlsManifestUrl
                        if (data["hlsManifestUrl"]) track.audio = data["hlsManifestUrl"];
                        else {
                            // Если есть расшифровка ссылки видео
                            if (data["formats"][0]) track.audio = data["formats"][0]["url"];
                        }
                    }

                    if (!cache) setImmediate(() => {
                        // Сохраняем кеш в системе
                        db.cache.set(track, this.url);
                    });

                    return track;
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных треков артиста
         * @type "artist"
         */
        {
            name: "artist",
            filter: /\/(channel)?(@)/i,
            execute: async (url: string, {limit}) => {
                try {
                    let ID: string;

                    // Получаем истинное id канала
                    if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                    else ID = `channel/${url.split("channel/")[1]}`;

                    // Создаем запрос
                    const details = await this.pAPI(`https://${this.url}/${ID}/videos`);

                    if (details instanceof Error) return details;

                    const author = details["microformat"]["microformatDataRenderer"];
                    const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                    const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                        ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, limit);

                    // Модифицируем видео
                    return contents.map(({richItemRenderer}: any) => {
                        const video = richItemRenderer?.content?.["videoRenderer"];

                        return {
                            url: `https://youtu.be/${video["videoId"]}`,
                            title: video.title["runs"][0].text,
                            duration: {full: video["lengthText"]["simpleText"]},
                            author: {url: `https://${this.url}/${ID}`, title: author.title}
                        }
                    });
                } catch (e) {
                    return new Error(`[APIs]: ${e}`);
                }
            },
        },

        /**
         * @description Запрос данных по поиску
         * @type "search"
         */
        {
            name: "search",
            execute: async (query: string, {limit}) => {
                try {
                    // Создаем запрос
                    const details = await this.pAPI(`https://${this.url}/results?search_query=${encodeURIComponent(query)}&sp=QgIIAQ%3D%3D`);

                    // Если при получении данных возникла ошибка
                    if (details instanceof Error) return details;

                    // Найденные видео
                    const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                    // Проверяем на наличие видео
                    if (vanilla_videos?.length === 0 || !vanilla_videos) return locale.err("api.request.fail");

                    const filtered_ = vanilla_videos?.filter((video: json) => video && video?.["videoRenderer"])?.splice(0, limit);
                    const videos: Track.data[] = filtered_.map(({ videoRenderer }: json) => this.track(videoRenderer));

                    return videos;
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
    protected pAPI = (url: string): Promise<Error | json> => {
        return new Promise((resolve) => {
            new httpsClient({ url,
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
                    const data = this._extractResponse(api);

                    // Если возникает ошибка при поиске на странице
                    if (data instanceof Error) return resolve(data);

                    return resolve(data);
                })

                // Если происходит ошибка
                .catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем страницу с данными
     * @param ID - ID видео
     * @param audio - нужно ли получить аудио
     * @protected
     */
    protected API = (ID: string, audio: boolean): Promise<Error | json> => {
        const client = audio ? Clients.ANDROID : Clients.WEB_EMBEDDED;

        return new Promise((resolve) => {
            new httpsClient({
                method: "POST",
                url: `https://www.youtube.com/youtubei/v1/player?key=${this.options.AIzaKey}`,
                headers: {
                    "Content-Type": "application/json",
                    ...client["headers"] ? client["headers"] : {}
                },
                body: JSON.stringify({
                    ...client.request,
                    "videoId": ID
                })
            })
                // Получаем исходную страницу
                .toJson

                // Получаем результат из Promise
                .then((api) => {
                    // Если возникает ошибка при получении страницы
                    if (api instanceof Error) return resolve(locale.err("api.request.fail"));

                    // Если указано аудио, но его нет!
                    else if (audio && !api["streamingData"]?.["formats"]) return resolve(locale.err("api.request.fail"));

                    // Отдаем данные
                    return resolve(api);
                })

                // Если происходит ошибка
                .catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем данные об авторе видео
     * @param id - ID канала
     * @param name - Название канала, если не будет найден канал будет возвращено название
     * @protected
     */
    protected getChannel = ({ id, name }: { id: string, name?: string }): Promise<Track.artist> => {
        return new Promise<Track.artist>((resolve) => {
            new httpsClient({
                url: `https:/www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`,
                headers: Clients.WEB.request.context.client
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
     */
    protected track = (track: json) => {
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
                image: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
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
                image: `https://i.ytimg.com/vi/${id}/maxresdefault.jpg`,
                audio: track?.format?.url || undefined
            }
        }
    };

    /**
     * @description Получаем данные из страницы
     * @param input - Страница
     * @protected
     */
    protected _extractResponse = (input: string): json | Error => {
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
        if (status && status !== "OK") {
            const reason = endData.playabilityStatus?.reason || "Not found status error";
            return new Error(locale._(locale.language, "api.request.fail.msg", [reason]));
        }

        return endData;
    };
}

/**
 * @author SNIPPIK
 * @description Допустимые символы, буквы, цифры для работы с youtube на более похожем уровне api
 * @const CPN_CHARS
 */
const CPN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * @author SNIPPIK
 * @description Генерируем уникальный индикатор устройства, фейковый конечно
 * @param length - Размер
 * @private
 */
function generateClientPlaybackNonce(length: number): string {
    return Array.from({ length }, () => CPN_CHARS[Math.floor(Math.random() * CPN_CHARS.length)]).join("");
}

/**
 * @author SNIPPIK
 * @description Генерируем фейковые ключи для плеера
 * @param totalLength - Глобальный размер ключа
 */
function generateFakeApiKey(totalLength = 34): string {
    let key = "AIzaSyAO_";

    for (let i = 0; i < totalLength - 4; i++) {
        key += CPN_CHARS.charAt(Math.floor(Math.random() * CPN_CHARS.length));
    }

    return key;
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [RestYouTubeAPI];