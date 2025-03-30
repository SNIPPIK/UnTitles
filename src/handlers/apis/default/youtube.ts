import {API, APISmall, httpsClient} from "@handler/apis";
import querystring from "node:querystring";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Script} from "node:vm";
import {Assign} from "@utils";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Assign<API> {
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
    protected static _platform: APISmall = {
        name: "YOUTUBE",
        url: "youtube.com",
        color: 16711680
    };

    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({ ...sAPI._platform,
            audio: true,
            auth: true,
            filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/gi,

            requests: [
                /**
                 * @description Запрос данных об плейлисте
                 * @type playlist
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

                            const api = await sAPI.API(`https://www.youtube.com/${ID}`)

                            // Если при запросе была получена ошибка
                            if (api instanceof Error) return resolve(api);

                            // Данные о плейлисте
                            const playlist = api["microformat"]["microformatDataRenderer"];

                            // Необработанные видео
                            const videos: any[] = api["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"];

                            // Все доступные видео в плейлисте
                            const items = videos.splice(0, limit).map(({playlistVideoRenderer}) => sAPI.track(playlistVideoRenderer));

                            // Раздел с данными автора
                            const author = api["sidebar"]["playlistSidebarRenderer"]["items"];

                            // Если авторов в плейлисте больше 1
                            if (author.length > 1) {
                                const authorData = author[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];

                                // Получаем истинные данные об авторе плейлиста
                                artist = await sAPI.getChannel({
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
                 * @type track
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
                                const cache = db.cache.get(`${sAPI._platform.url}/${ID}`);

                                // Если найден трек или похожий объект
                                if (cache && !options?.audio) return resolve(cache);

                                const api = await sAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&bpctr=${Math.ceil(Date.now() / 1000)}&has_verified=1`);

                                /// Если при получении данных возникла ошибка
                                if (api instanceof Error) return resolve(api);

                                // Расшифровываем аудио формат
                                const format = await sAPI.extractFormat(url, api["streamingData"], api.html);

                                // Если есть расшифровка ссылки видео
                                if (format) api["videoDetails"]["format"] = {url: format["url"]};

                                // Класс трека
                                const track = sAPI.track(api["videoDetails"]);

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
                 * @type author
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
                                const details = await sAPI.API(`https://www.youtube.com/${ID}/videos`);

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
                 * @type search
                 */
                {
                    name: "search",
                    execute: (url: string, {limit}): Promise<Track[] | Error> => {
                        return new Promise<Track[] | Error>(async (resolve) => {
                            try {
                                // Создаем запрос
                                const details = await sAPI.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                // Если при получении данных возникла ошибка
                                if (details instanceof Error) return resolve(details);

                                // Найденные видео
                                const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                // Проверяем на наличие видео
                                if (vanilla_videos?.length === 0 || !vanilla_videos) return resolve(locale.err("api.request.fail"));

                                let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                let videos: Track[] = filtered_.map(({ videoRenderer }: any) => sAPI.track(videoRenderer));

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
        if (sAPI._encoder === "ytdl") return YouTube_encoder_ytd.decipherFormats(url);
        else return new Promise(async (resolve) => {
            if (!data["formats"]) return resolve(null);
            const decoder = await Youtube_decoder_native.decipherFormats(data["formats"], html);

            // Если произошла ошибка при расшифровке
            if (decoder[0] instanceof Error) return resolve(decoder[0]);

            return resolve(decoder.at(-1));
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
            }, sAPI._platform);
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
            }, sAPI._platform)
        }
    };
}



/**
 * @author SNIPPIK
 * @description Сторонний расшифровщик аудио
 * @name YouTube_encoder_ytd
 */
class YouTube_encoder_ytd {
    /**
     * @description Код для выполнения запуска youtube-dl
     * @private
     */
    private static runCommand = null;

    /**
     * @description Получаем аудио дорожку
     * @param url - Ссылка на видео
     * @public
     */
    public static decipherFormats = (url: string): Promise<YouTubeFormat | Error> => {
        try {
            // Если нет загруженной команды запуска
            if (!this.runCommand) this.runCommand = require("youtube-dl-exec");
        } catch {
            // Если нет youtube-dl-exec
            throw Error("YouTube-Dl is not installed! Pls install youtube-dl-exec");
        }

        // Запускаем команду
        return new Promise((resolve) => {
            return this.runCommand(url, {
                printJson: true,
                skipDownload: true,
                noWarnings: true,
                noCheckCertificates: true,
                preferFreeFormats: true,
                addHeader: ['referer:youtube.com', 'user-agent:googlebot']
            }).then((output) => {
                if (typeof output === "string") return resolve(Error(`[APIs]: ${output}`));

                const format = output.formats.find((format: YouTubeFormat) => format.acodec && format.acodec.match(/opus/));
                return resolve(format);
            })
        });
    }
}

/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param pattern - Как искать имена
 * @param text - Строка где будем искать
 */
const mRegex = (pattern: string | RegExp, text: string) => {
    const match = text.match(pattern);
    return match ? match[1].replace(/\$/g, "\\$") : null;
};

/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на исходный файл для youtube
 * @class Youtube_decoder
 */
class Youtube_decoder_native {
    /**
     * @author SNIPPIK
     * @description Функции для расшифровки
     */
    private static extractors: { name: string, callback: (body: string) => string }[] = [
        /**
         * @description Получаем функцию с данными
         */
        {
            name: "extractDecipherFunction",
            callback: (body) => {
                try {
                    const helperMatch = body.match(new RegExp(HELPER_REGEXP, "s"));
                    if (!helperMatch) return null;

                    const helperObject = helperMatch[0];
                    const actionBody = helperMatch[2];

                    const reverseKey = mRegex(REVERSE_PATTERN, actionBody);
                    const sliceKey = mRegex(SLICE_PATTERN, actionBody);
                    const spliceKey = mRegex(SPLICE_PATTERN, actionBody);
                    const swapKey = mRegex(SWAP_PATTERN, actionBody);

                    const quotedFunctions = [reverseKey, sliceKey, spliceKey, swapKey].filter(Boolean)
                        .map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

                    // Если нет ожидаемых функций
                    if (quotedFunctions.length === 0) return null;

                    const funcMatch = body.match(new RegExp(DECIPHER_REGEXP, "s"));
                    let tceVars = "";
                    let decipherFunc: string

                    // Если найдена функция
                    if (funcMatch) decipherFunc = funcMatch[0];
                    else {
                        const tceFuncMatch = body.match(new RegExp(FUNCTION_TCE_REGEXP, "s"));

                        // Если не найдена вспомогательная функция
                        if (!tceFuncMatch) return null;

                        decipherFunc = tceFuncMatch[0];
                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));

                        // Если удалось найти вспомогательные параметры
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    const resultFunc = tceVars + helperObject + "\nvar " + DECIPHER_FUNC_NAME + "=" + decipherFunc + ";\n";
                    const callerFunc = DECIPHER_FUNC_NAME + "(" + DECIPHER_ARGUMENT + ");";

                    return resultFunc + callerFunc;
                } catch (e) {
                    console.error("Error in extractDecipherFunction:", e);
                    return null;
                }
            }
        },

        /**
         * @description Получаем данные n кода - для ускоренной загрузки с серверов
         */
        {
            name: "extractNTransformFunction",
            callback: (body) => {
                try {
                    const nMatch = body.match(new RegExp(N_TRANSFORM_REGEXP, "s"));
                    let tceVars = "";
                    let nFunction: string;

                    // Если найдена функция
                    if (nMatch) nFunction = nMatch[0];
                    else {
                        const nTceMatch = body.match(new RegExp(N_TRANSFORM_TCE_REGEXP, "s"));

                        // Если нет вспомогательные функций вычисления
                        if (!nTceMatch) return null;

                        nFunction = nTceMatch[0];

                        const tceVarsMatch = body.match(new RegExp(TCE_GLOBAL_VARS_REGEXP, "m"));

                        // Если вспомогательные параметры найдены
                        if (tceVarsMatch) tceVars = tceVarsMatch[1] + ";\n";
                    }

                    const paramMatch = nFunction.match(/function\s*\(\s*(\w+)\s*\)/);

                    // Если не найдено параметров
                    if (!paramMatch) return null;

                    const resultFunc = tceVars + "var " + N_TRANSFORM_FUNC_NAME + "=" + nFunction.replace(
                        new RegExp(`if\\s*\\(typeof\\s*[^\\s()]+\\s*===?.*?\\)return ${paramMatch[1]}\\s*;?`, "g"),
                        ""
                    ) + ";\n";
                    const callerFunc = N_TRANSFORM_FUNC_NAME + "(" + N_ARGUMENT + ");";

                    return resultFunc + callerFunc;
                } catch (e) {
                    console.error("Error in extractNTransformFunction:", e);
                    return null;
                }
            }
        }
    ];

    /**
     * @description Применяем преобразования decipher и n параметров ко всем URL-адресам формата.
     * @param formats - Все форматы аудио или видео
     * @param html5player - Ссылка на плеер
     */
    public static decipherFormats = async (formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat[]> => {
        const [decipher, nTransform] = await this.extractPage(html5player);
        for (let item of formats) this.getting_url(item, {decipher, nTransform});
        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     */
    private static getting_url = (format: YouTubeFormat, {decipher, nTransform}: YouTubeChanter): void => {
        const extractDecipher = (url: string): string => {
            const args = querystring.parse(url);
            if (!args.s || !decipher) return args.url as string;

            try {
                const components = new URL(decodeURIComponent(args.url as string));
                const context = {};
                context[DECIPHER_ARGUMENT] = decodeURIComponent(args.s as string);
                const decipheredSig = decipher.runInNewContext(context);

                components.searchParams.set((args.sp || "sig") as string, decipheredSig);
                return components.toString();
            } catch (err) {
                console.error("Error applying decipher:", err);
                return args.url as string;
            }
        };
        const extractNTransform = (url: string): string => {
            try {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get("n");

                if (!n || !nTransform) return url;

                const context = {};
                context[N_ARGUMENT] = n;
                const transformedN = nTransform.runInNewContext(context);

                if (transformedN) {

                    if (n === transformedN) {
                        console.warn("Transformed n parameter is the same as input, n function possibly short-circuited");
                    } else if (transformedN.startsWith("enhanced_except_") || transformedN.endsWith("_w8_" + n)) {
                        console.warn("N function did not complete due to exception");
                    }

                    components.searchParams.set("n", transformedN);
                } else {
                    console.warn("Transformed n parameter is null, n function possibly faulty");
                }

                return components.toString();
            } catch (err) {
                console.error("Error applying n transform:", err);
                return url;
            }
        };

        const cipher = !format.url;
        const url = format.url || format.signatureCipher || format.cipher;

        if (!url) return;

        try {
            format.url = extractNTransform(cipher ? extractDecipher(url) : url);

            delete format.signatureCipher;
            delete format.cipher;
        } catch (err) {
            console.error("Error set download URL:", err);
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param html5 - Ссылка на плеер
     */
    private static extractPage = async (html5: string) => {
        const body = await new httpsClient(html5).toString;

        if (body instanceof Error) return null;
        return [
            this.extractDecipher(body),
            this.extractNTransform(body)
        ];
    };

    /**
     * @description Извлекает функции расшифровки N типа
     * @param body - Страница плеера
     */
    private static extractNTransform = (body: string) => {
        try {
            const nTransformFunc = this.extraction([this.extractors[1].callback], body);

            if (!nTransformFunc) return null;
            return nTransformFunc;
        } catch {
            return null;
        }
    };

    /**
     * @description Извлекает функции расшифровки сигнатур и преобразования n параметров из файла html5 player.
     * @param body - Страница плеера
     */
    private static extractDecipher = (body: string) => {
        const decipherFunc = this.extraction([this.extractors[0].callback], body);
        if (!decipherFunc) return null;
        return decipherFunc;
    };

    /**
     * @description Получаем функции для расшифровки
     * @param functions - Функции расшифровки
     * @param body - Станица youtube
     * @param postProcess - Если есть возможность обработать сторонний код
     */
    private static extraction = (functions: Function[], body: string, postProcess = null) => {
        // Перебираем функции
        for (const callback of functions) {
            try {
                // Если есть функция
                const func = callback(body);

                // Если нет функции
                if (!func) continue;

                // Выполняем виртуальный код
                return new Script(postProcess ? postProcess(func) : func);
            } catch {
                return null;
            }
        }

        // Возвращаем null если не получилось выполнить скрипт
        return null;
    };
}

/**
 * @author SNIPPIK
 * @description Общий стандарт аудио или видео json объекта
 * @interface YouTubeFormat
 */
interface YouTubeFormat {
    url: string;
    signatureCipher?: string;
    cipher?: string
    sp?: string;
    s?: string;
    mimeType?: string;
    bitrate?: number;
    acodec?: string;
}

/**
 * @author SNIPPIK
 * @description Варианты расшифровки url
 * @interface YouTubeChanter
 */
interface YouTubeChanter {
    decipher?: Script;
    nTransform?: Script;
}

const DECIPHER_FUNC_NAME = "YTDDecipherFunc";
const N_TRANSFORM_FUNC_NAME = "YTDNTransformFunc";

const VARIABLE_PART = "[a-zA-Z_\\$][a-zA-Z_0-9\\$]*";
const VARIABLE_PART_DEFINE = "\\\"?" + VARIABLE_PART + "\\\"?";
const BEFORE_ACCESS = "(?:\\[\\\"|\\.)";
const AFTER_ACCESS = "(?:\\\"\\]|)";
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ":function\\(\\w\\)\\{(?:return )?\\w\\.reverse\\(\\)\\}";
const SLICE_PART = ":function\\(\\w,\\w\\)\\{return \\w\\.slice\\(\\w\\)\\}";
const SPLICE_PART = ":function\\(\\w,\\w\\)\\{\\w\\.splice\\(0,\\w\\)\\}";
const SWAP_PART = ":function\\(\\w,\\w\\)\\{" +
    "var \\w=\\w\\[0\\];\\w\\[0\\]=\\w\\[\\w%\\w\\.length\\];\\w\\[\\w(?:%\\w.length|)\\]=\\w(?:;return \\w)?\\}";

const DECIPHER_REGEXP =
    "function(?: " + VARIABLE_PART + ")?\\(([a-zA-Z])\\)\\{" +
    "\\1=\\1\\.split\\(\"\"\\);\\s*" +
    "((?:(?:\\1=)?" + VARIABLE_PART + VARIABLE_PART_ACCESS + "\\(\\1,\\d+\\);)+)" +
    "return \\1\\.join\\(\"\"\\)" +
    "\\}";

const HELPER_REGEXP =
    "var (" + VARIABLE_PART + ")=\\{((?:(?:" +
    VARIABLE_PART_DEFINE + REVERSE_PART + "|" +
    VARIABLE_PART_DEFINE + SLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SPLICE_PART + "|" +
    VARIABLE_PART_DEFINE + SWAP_PART +
    "),?\\n?)+)\\};";

const FUNCTION_TCE_REGEXP =
    "function(?:\\s+[a-zA-Z_\\$][a-zA-Z0-9_\\$]*)?\\(\\w\\)\\{" +
    "\\w=\\w\\.split\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\);" +
    "\\s*((?:(?:\\w=)?[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\[\\\"|\\.)[a-zA-Z_\\$][a-zA-Z0-9_\\$]*(?:\\\"\\]|)\\(\\w,\\d+\\);)+)" +
    "return \\w\\.join\\((?:\"\"|[a-zA-Z0-9_$]*\\[\\d+])\\)}";

const N_TRANSFORM_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
    "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
    "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};';

const N_TRANSFORM_TCE_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*var\\s*(\\w+)=\\1\\.split\\(\\1\\.slice\\(0,0\\)\\),\\s*(\\w+)=\\[.*?];" +
    ".*?catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "\\s*return(?:\"[^\"]+\"|\\s*[a-zA-Z_0-9$]*\\[\\d+])\\s*\\+\\s*\\1\\s*}" +
    "\\s*return\\s*\\2\\.join\\((?:\"\"|[a-zA-Z_0-9$]*\\[\\d+])\\)};";

const TCE_GLOBAL_VARS_REGEXP =
    "(?:^|[;,])\\s*(var\\s+([\\w$]+)\\s*=\\s*" +
    "(?:" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\3" +
    "\\s*\\.\\s*split\\((" +
    "([\"'])(?:\\\\.|[^\\\\])*?\\5" +
    "\\))" +
    "|" +
    "\\[\\s*(?:([\"'])(?:\\\\.|[^\\\\])*?\\6\\s*,?\\s*)+\\]" +
    "))(?=\\s*[,;])";

const PATTERN_PREFIX = "(?:^|,)\\\"?(" + VARIABLE_PART + ")\\\"?";
const REVERSE_PATTERN = new RegExp(PATTERN_PREFIX + REVERSE_PART, "m");
const SLICE_PATTERN = new RegExp(PATTERN_PREFIX + SLICE_PART, "m");
const SPLICE_PATTERN = new RegExp(PATTERN_PREFIX + SPLICE_PART, "m");
const SWAP_PATTERN = new RegExp(PATTERN_PREFIX + SWAP_PART, "m");

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI });