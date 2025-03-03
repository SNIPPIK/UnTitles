import {API, httpsClient} from "@handler/apis";
import querystring from "node:querystring";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Script} from "node:vm";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Assign<API> {
    /**
     * @description Создаем экземпляр запросов
     * @constructor sAPI
     * @public
     */
    public constructor() {
        super({
            name: "YOUTUBE",
            audio: true,
            auth: true,

            color: 16711680,
            filter: /https?:\/\/(?:youtu\.be|(?:(?:www|m|music|gaming)\.)?youtube\.com)/gi,
            url: "youtube.com",

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
                            // Если ID плейлиста не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err("api.request.id.playlist"));

                            try {
                                // Создаем запрос
                                const api = await sAPI.API(`https://www.youtube.com/${ID}`);

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
                                    artist = await sAPI.getChannel({ id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"], name: authorData.title["runs"][0].text });
                                }

                                return resolve({
                                    url, items,
                                    title: playlist.title,
                                    image: playlist.thumbnail["thumbnails"].pop(),
                                    artist: artist ?? items.at(-1).artist
                                });
                            } catch (e) {
                                return resolve(new Error(`[APIs]: ${e}`));
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
                            // Если ID видео не удалось извлечь из ссылки
                            if (!ID) return resolve(locale.err( "api.request.id.track"));

                            // Интеграция с утилитой кеширования
                            const cache = db.cache.get(ID);

                            // Если найден трек или похожий объект
                            if (cache && !options?.audio) return resolve(cache);

                            try {
                                // Создаем запрос
                                const result = await sAPI.API(`https://www.youtube.com/watch?v=${ID}&hl=en&has_verified=1`);

                                /// Если при получении данных возникла ошибка
                                if (result instanceof Error) return resolve(result);

                                // Расшифровываем аудио формат
                                const format = await sAPI.extractFormat(result["streamingData"], result.html);

                                // Если есть расшифровка ссылки видео
                                if (format) result["videoDetails"]["format"] = {url: format["url"]};

                                // Класс трека
                                const track = sAPI.track(result["videoDetails"]);

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
     * @param data - <videoData>.streamingData все форматы видео, будет выбран оптимальный
     * @param html - Ссылка на html плеер
     * @protected
     * @static
     */
    protected static extractFormat = (data: json, html: string): Promise<YouTubeFormat> => {
        return new Promise(async (resolve) => {
            if (!data["formats"]) return resolve(null);
            const decoder = await Youtube_decoder.decipherFormats(data["formats"], html);

            // Если произошла ошибка при расшифровке
            if (decoder[0] instanceof Error) return resolve(decoder[0]);

            return resolve(decoder[0]);
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
        if (startIndex === -1 && endIndex === -1) return null;

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
                image: track.thumbnail["thumbnails"].pop(),
                audio: track?.format?.url || undefined
            });
        } catch (err) {
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
                image: track.thumbnail["thumbnails"].pop(),
                audio: track?.format?.url || undefined
            })
        }
    };
}



/**
 * @author SNIPPIK
 * @description Ищем имена в строке
 * @param regex - Как искать имена
 * @param body - Строка где будем искать
 * @param id - Номер объекта
 */
const mRegex = (regex: string | RegExp, body: string, id: number = 0) => {
    const match = body.match(new RegExp(regex, "s"));
    if (!match) return null;
    return match[id];
};

/**
 * @author SNIPPIK
 * @description Получаем имена функций
 * @param body - Станица youtube
 * @param regexps
 */
const extractName = (body: string, regexps: any): string => {
    let name: string;

    for (const [regex, id] of Object.entries(regexps)) {
        try {
            name = mRegex(regex, body, id as number);
            try {
                name = mRegex(`${name.replace(/\$/g, "\\$")}=\\[([a-zA-Z0-9$\\[\\]]{2,})\\]`, body, 1);
            } catch {
                // Function name is not inside an array
            }
            break;
        } catch {}
    }

    return name;
};

/**
 * @author SNIPPIK
 * @description Функции для расшифровки
 */
const extractors: { name: string, callback: (body: string) => string }[] = [
    /**
     * @description Получаем функцию с данными
     */
    {
        name: "extractDecipherFunction",
        callback: (body) => {
            try {
                const helperObject = mRegex(HELPER_REGEXP, body);
                const decipherFunc = mRegex(DECIPHER_REGEXP, body);
                const resultFunc = `var ${DECIPHER_FUNC_NAME}=${decipherFunc};`;
                const callerFunc = `${DECIPHER_FUNC_NAME}(${DECIPHER_ARGUMENT});`;
                return helperObject + resultFunc + callerFunc;
            } catch {
                return null;
            }
        }
    },

    /**
     * @description Получаем имя функции
     */
    {
        name: "extractDecipherWithName",
        callback: (body) => {
            try {
                const decipherFuncName = extractName(body, DECIPHER_NAME_REGEXPS);
                const funcPattern = `(${decipherFuncName.replace(/\$/g, '\\$')}=function\\([a-zA-Z0-9_]+\\)\\{.+?\\})`;
                const decipherFunc = `var ${mRegex(funcPattern, body, 1)};`;
                const helperObjectName = mRegex(";([A-Za-z0-9_\\$]{2,})\\.\\w+\\(", decipherFunc, 1);
                const helperPattern = `(var ${helperObjectName.replace(/\$/g, '\\$')}=\\{[\\s\\S]+?\\}\\};)`;
                const helperObject = mRegex(helperPattern, body, 1);
                const callerFunc = `${decipherFuncName}(${DECIPHER_ARGUMENT});`;
                return helperObject + decipherFunc + callerFunc;
            } catch {
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
                const nFunc = mRegex(N_TRANSFORM_REGEXP, body);
                const resultFunc = `var ${N_TRANSFORM_FUNC_NAME}=${nFunc}`;
                const callerFunc = `${N_TRANSFORM_FUNC_NAME}(${N_ARGUMENT});`;
                return resultFunc + callerFunc;
            } catch {
                return null;
            }
        }
    },

    /**
     * @description Извлекаем название n
     */
    {
        name: "extractNTransformWithName",
        callback: (body) => {
            try {
                const nFuncName = extractName(body, N_TRANSFORM_NAME_REGEXPS);
                const funcPattern = `(${nFuncName.replace(/\$/g, "\\$")}=function\\([a-zA-Z0-9_]+\\)\\{.+?\\})`;
                const nTransformFunc = `var ${mRegex(funcPattern, body, 1)};`;
                const callerFunc = `${nFuncName}(${N_ARGUMENT});`;
                return nTransformFunc + callerFunc;
            } catch {
                return null;
            }
        }
    }
];

/**
 * @author SNIPPIK
 * @description Расшифровщик ссылок на исходный файл для youtube
 * @class Youtube_decoder
 */
export class Youtube_decoder {
    /**
     * @description Применяем преобразования decipher и n параметров ко всем URL-адресам формата.
     * @param formats - Все форматы аудио или видео
     * @param html5player - Ссылка на плеер
     */
    public static decipherFormats = async (formats: YouTubeFormat[], html5player: string): Promise<YouTubeFormat[]> =>  {
        const [decipherScript, nTransformScript] = await this.extractPage(html5player);

        for (let item of formats) {
            this.getting_url(item, {decipher: decipherScript, nTransform: nTransformScript});
        }

        return formats;
    };

    /**
     * @description Применить расшифровку и n-преобразование к индивидуальному формату
     * @param format - Аудио или видео формат на youtube
     * @param script - Скрипт для выполнения на виртуальной машине
     */
    private static getting_url = (format: YouTubeFormat, script: {decipher?: Script, nTransform?: Script}): void => {
        const {decipher, nTransform} = script;

        const extractDecipher = (url: string): string => {
            try {
                const args = querystring.parse(url);
                if (!args.s || !decipher) return args.url as string;

                const components = new URL(decodeURIComponent(args.url as string));
                components.searchParams.set(args.sp as string ? args.sp as string : DECIPHER_ARGUMENT, decipher.runInNewContext({sig: decodeURIComponent(args.s as string)}));
                return components.toString();
            } catch {
                return null;
            }
        };
        const extractNTransform = (url: string): string => {
            try {
                const components = new URL(decodeURIComponent(url));
                const n = components.searchParams.get("n");
                if (!n || !nTransform) return url;
                components.searchParams.set("n", nTransform.runInNewContext({ncode: n}));
                return components.toString();
            } catch {
                return null;
            }
        };

        const cipher = !format.url;
        const url = format.url || format.signatureCipher || format.cipher;
        format.url = extractNTransform(cipher ? extractDecipher(url) : url);
        delete format.signatureCipher;
        delete format.cipher;
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
            const nTransformFunc = this.extraction([extractors[2].callback, extractors[3].callback], body, (code: string) =>
                code.replace(/if\s*\(\s*typeof\s*[\w$]+\s*===?.*?\)\s*return\s+[\w$]+\s*;?/, "")
            );

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
        const decipherFunc = this.extraction([extractors[0].callback, extractors[1].callback], body);
        if (!decipherFunc) return null;
        return decipherFunc;
    };

    /**
     * @description Получаем функции для расшифровки
     * @param functions -
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
}

const DECIPHER_FUNC_NAME = "getDecipherFunc";
const N_TRANSFORM_FUNC_NAME = "getNTransformFunc";

const DECIPHER_NAME_REGEXPS = {
    "\\b([a-zA-Z0-9_$]+)&&\\(\\1=([a-zA-Z0-9_$]{2,})\\(decodeURIComponent\\(\\1\\)\\)": 2,
    '([a-zA-Z0-9_$]+)\\s*=\\s*function\\(\\s*([a-zA-Z0-9_$]+)\\s*\\)\\s*{\\s*\\2\\s*=\\s*\\2\\.split\\(\\s*""\\s*\\)\\s*;\\s*[^}]+;\\s*return\\s+\\2\\.join\\(\\s*""\\s*\\)': 1,
    '/(?:\\b|[^a-zA-Z0-9_$])([a-zA-Z0-9_$]{2,})\\s*=\\s*function\\(\\s*a\\s*\\)\\s*{\\s*a\\s*=\\s*a\\.split\\(\\s*""\\s*\\)(?:;[a-zA-Z0-9_$]{2}\\.[a-zA-Z0-9_$]{2}\\(a,\\d+\\))?/': 1,
    "\\bm=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(h\\.s\\)\\)": 1,
    "\\bc&&\\(c=([a-zA-Z0-9$]{2,})\\(decodeURIComponent\\(c\\)\\)": 1,
    '(?:\\b|[^a-zA-Z0-9$])([a-zA-Z0-9$]{2,})\\s*=\\s*function\\(\\s*a\\s*\\)\\s*\\{\\s*a\\s*=\\s*a\\.split\\(\\s*""\\s*\\)': 1,
    '([\\w$]+)\\s*=\\s*function\\((\\w+)\\)\\{\\s*\\2=\\s*\\2\\.split\\(""\\)\\s*;': 1,
};

// LavaPlayer regexps
const VARIABLE_PART = "[a-zA-Z_\\$][a-zA-Z_0-9]*";
const VARIABLE_PART_DEFINE = `\\"?${VARIABLE_PART}\\"?`;
const BEFORE_ACCESS = '(?:\\[\\"|\\.)';
const AFTER_ACCESS = '(?:\\"\\]|)';
const VARIABLE_PART_ACCESS = BEFORE_ACCESS + VARIABLE_PART + AFTER_ACCESS;
const REVERSE_PART = ":function\\(\\w\\)\\{(?:return )?\\w\\.reverse\\(\\)\\}";
const SLICE_PART = ":function\\(\\w,\\w\\)\\{return \\w\\.slice\\(\\w\\)\\}";
const SPLICE_PART = ":function\\(\\w,\\w\\)\\{\\w\\.splice\\(0,\\w\\)\\}";
const SWAP_PART =
    ":function\\(\\w,\\w\\)\\{var \\w=\\w\\[0\\];\\w\\[0\\]=\\w\\[\\w%\\w\\.length\\];\\w\\[\\w(?:%\\w.length|)\\]=\\w(?:;return \\w)?\\}";

// LavaPlayer regexps
const N_TRANSFORM_REGEXP =
    "function\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    "var\\s*(\\w+)=(?:\\1\\.split\\(.*?\\)|String\\.prototype\\.split\\.call\\(\\1,.*?\\))," +
    "\\s*(\\w+)=(\\[.*?]);\\s*\\3\\[\\d+]" +
    "(.*?try)(\\{.*?})catch\\(\\s*(\\w+)\\s*\\)\\s*\\{" +
    '\\s*return"[\\w-]+([A-z0-9-]+)"\\s*\\+\\s*\\1\\s*}' +
    '\\s*return\\s*(\\2\\.join\\(""\\)|Array\\.prototype\\.join\\.call\\(\\2,.*?\\))};';

const DECIPHER_REGEXP =
    `function(?: ${VARIABLE_PART})?\\(([a-zA-Z])\\)\\{` +
    '\\1=\\1\\.split\\(""\\);\\s*' +
    `((?:(?:\\1=)?${VARIABLE_PART}${VARIABLE_PART_ACCESS}\\(\\1,\\d+\\);)+)` +
    'return \\1\\.join\\(""\\)' +
    `\\}`;

const HELPER_REGEXP = `var (${VARIABLE_PART})=\\{((?:(?:${VARIABLE_PART_DEFINE}${REVERSE_PART}|${
    VARIABLE_PART_DEFINE
}${SLICE_PART}|${VARIABLE_PART_DEFINE}${SPLICE_PART}|${VARIABLE_PART_DEFINE}${SWAP_PART}),?\\n?)+)\\};`;

const SCVR = "[a-zA-Z0-9$_]";
const MCR = `${SCVR}+`;
const AAR = "\\[(\\d+)]";
const N_TRANSFORM_NAME_REGEXPS = {
    [`${SCVR}="nn"\\[\\+${MCR}\\.${MCR}],${MCR}\\(${MCR}\\),${MCR}=${MCR}\\.${MCR}\\[${MCR}]\\|\\|null\\).+\\|\\|(${MCR})\\(""\\)`]: 1,
    [`${SCVR}="nn"\\[\\+${MCR}\\.${MCR}],${MCR}\\(${MCR}\\),${MCR}=${MCR}\\.${MCR}\\[${MCR}]\\|\\|null\\)&&\\(${MCR}=(${MCR})${AAR}`]: 1,
    [`${SCVR}="nn"\\[\\+${MCR}\\.${MCR}],${MCR}=${MCR}\\.get\\(${MCR}\\)\\).+\\|\\|(${MCR})\\(""\\)`]: 1,
    [`${SCVR}="nn"\\[\\+${MCR}\\.${MCR}],${MCR}=${MCR}\\.get\\(${MCR}\\)\\)&&\\(${MCR}=(${MCR})\\[(\\d+)]`]: 1,
    [`\\(${SCVR}=String\\.fromCharCode\\(110\\),${SCVR}=${SCVR}\\.get\\(${SCVR}\\)\\)&&\\(${SCVR}=(${MCR})(?:${AAR})?\\(${SCVR}\\)`]: 1,
    [`\\.get\\("n"\\)\\)&&\\(${SCVR}=(${MCR})(?:${AAR})?\\(${SCVR}\\)`]: 1,
};

const DECIPHER_ARGUMENT = "sig";
const N_ARGUMENT = "ncode";

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI });