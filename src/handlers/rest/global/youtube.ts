import { APIRequestData, DeclareRest, OptionsRest, RestServerSide } from "#handler/rest/index.js";
import { httpsClient, locale } from "#structures";
import { sdb } from "#db/worker";

/**
 * @author SNIPPIK
 * @description Взаимодействие с платформой YouTube, динамический плагин
 * # Types
 * - Video - Любое видео с платформы. Не получится получить спонсорские видео или 18+
 * - Playlist - Любой открытый плейлист.
 * - Artist - Последние видео автора с учетом лимита
 * - Related - Похожее треки, работает через алгоритмы youtube
 * - Search - Поиск видео, пока не доступны плейлисты, альбомы, авторы
 * @Specification Rest YT API
 * @Audio Доступно нативное получение
 */

/**
 * @author SNIPPIK
 * @description Допустимые символы, буквы, цифры для работы с youtube на более похожем уровне api
 * @const CPN_CHARS
 * @private
 */
const CPN_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * @author SNIPPIK
 * @description Все допустимые заголовки
 * @const Clients
 * @private
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
                    clientVersion: "21.03.36",
                    platform: "MOBILE",
                    osName: "Android",
                    osVersion: "16",
                    androidSdkVersion: "36",
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
            "User-Agent": `com.google.android.youtube/21.03.36(Linux; U; Android 16; en_US; SM-S908E Build/TP1A.220624.014) gzip`,
            "X-Goog-Api-Format-Version": "2"
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
            context: {
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
    auth: false,
    color: 16711680,
    retry: true
})
@OptionsRest({
    AIzaKey: generateFakeApiKey()
})
class RestYouTubeAPI extends RestServerSide.API {
    readonly requests: RestServerSide.API["requests"] = [
        /**
         * @description Запрос данных об плейлисте
         * @type "playlist"
         * @private
         */
        {
            name: "playlist",
            filter: /playlist\?list=[a-zA-Z0-9-_]+/i,
            execute: async (url, { limit }) => {
                const ID = this.getID(/playlist\?list=[a-zA-Z0-9-_]+/i, url)[0];
                let artist = null;

                try {
                    // Если ID плейлиста не удалось извлечь из ссылки
                    if (!ID) return locale.err("api.request.id.playlist");

                    const api = await this.pAPI(ID);

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
                        artist = await this.restArtist({
                            id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"],
                            name: authorData.title["runs"][0].text
                        });
                    }

                    return {
                        url, items,
                        title: playlist.title ?? "Related videos",
                        image: playlist.thumbnail["thumbnails"].pop(),
                        artist: artist ?? items.at(-1).artist
                    };
                } catch (e) {
                    console.error(e);
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос треков из волны, для выполнения требуется указать list=RD в ссылке
         * @type "related"
         * @private
         */
        {
            name: "related",
            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})?(list=RD)/,
            execute: async (url) => {
                const ID = this.getID(/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/, url);

                try {
                    const api = await this.pAPI(`watch?v=${ID}&hl=en&has_verified=1`);
                    if (api instanceof Error) return api;

                    const related = api.contents?.twoColumnWatchNextResults?.secondaryResults?.secondaryResults?.results[0].itemSectionRenderer.contents ?? [];
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
                    console.error(e);
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных о треке
         * @type "track"
         * @private
         */
        {
            name: "track",
            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/,
            execute: async (url, { audio }) => {
                const ID = this.getID(/(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/, url)[0];

                try {
                    // Если ID видео не удалось извлечь из ссылки
                    if (!ID) return locale.err("api.request.id.track");

                    const cache = sdb?.meta_saver?.get?.(`${this.url}/track/${ID}`);

                    // Если трек есть в кеше
                    if (cache) {
                        if (!audio) return cache;

                        // Если включена утилита кеширования аудио
                        else if (sdb.audio_saver) {
                            const check = await sdb.audio_saver.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                cache.audio = check.path;
                                return cache;
                            }
                        }

                        // Если нет возможности получить аудио
                        if (!this.audio) return cache;
                    }

                    let api = await this.API(ID, audio);

                    // Если при получении данных возникла ошибка
                    if (api instanceof Error || api["playabilityStatus"]["status"] !== "OK") {
                        // Пробуем получить страницу нативно без API
                        api = await this.pAPI(`watch?v=${ID}`);

                        // Если все равно возникает ошибка
                        if (api instanceof Error) return api;
                    }

                    // Класс трека
                    const track = this.track(api["videoDetails"]);

                    // Если указано получение аудио
                    if (audio && this.audio) {
                        // Если включена утилита кеширования
                        if (sdb.audio_saver) {
                            const check = await sdb.audio_saver.status(`${this.url}/${ID}`);

                            // Если есть кеш аудио
                            if (check.status === "ended") {
                                track.audio = check.path;
                                return track;
                            }
                        }

                        const data = api["streamingData"];

                        // dashManifestUrl, hlsManifestUrl
                        if (data["hlsManifestUrl"]) track.audio = data["dashManifestUrl"];
                        else {
                            // Если есть расшифровка ссылки видео
                            if (data["formats"]) track.audio = data["formats"][0]["url"];
                        }
                    }

                    // Сохраняем кеш в системе
                    if (!cache && !api?.["videoDetails"]?.["isLive"]) sdb.meta_saver?.set?.(track, `${this.url}/track`);

                    return track;
                } catch (e) {
                    console.error(e);
                    return Error(`[APIs]: ${e}`);
                }
            }
        },

        /**
         * @description Запрос данных треков артиста
         * @type "artist"
         * @private
         */
        {
            name: "artist",
            filter: /\/(channel)?(@)/i,
            execute: async (url, {limit}) => {
                const ID = this.getID(/^(?:@([^\/]+)|([a-zA-Z0-9_-]+))\/?/, url);

                try {
                    // Если ID автора не удалось извлечь из ссылки
                    if (!ID) return locale.err("api.request.id.author");

                    // Создаем запрос
                    const details = await this.pAPI(`${ID}/videos`);

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
                    console.error(e);
                    return Error(`[APIs]: ${e}`);
                }
            },
        },

        /**
         * @description Запрос данных по поиску
         * @type "search"
         * @private
         */
        {
            name: "search",
            execute: async (query: string, {limit}) => {
                try {
                    // Создаем запрос
                    const details = await this.pAPI(`results?search_query=${encodeURIComponent(query)}&sp=QgIIAQ%3D%3D`);

                    // Если при получении данных возникла ошибка
                    if (details instanceof Error) return details;

                    // Найденные видео
                    const vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                    // Проверяем на наличие видео
                    if (vanilla_videos?.length === 0 || !vanilla_videos) return locale.err("api.request.fail");

                    const filtered_ = vanilla_videos?.filter((video: json) => video && video?.["videoRenderer"])?.splice(0, limit);
                    return filtered_.map(({videoRenderer}: json) => this.track(videoRenderer));
                } catch (e) {
                    console.error(e);
                    return Error(`[APIs]: ${e}`);
                }
            }
        }
    ];

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
                }),
                agent: this.agent
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
     * @description Подготавливаем трек к отправке
     * @param track - Данные видео
     * @protected
     */
    protected track = (track: json) => {
        const title = track?.title?.simpleText ?? track?.title?.["runs"]?.[0]?.text ?? track?.title;
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
     * @description Получаем страницу и ищем на ней данные
     * @param method - Ссылка на видео или ID видео
     * @protected
     */
    protected pAPI = (method: string): Promise<Error | json> => {
        return new Promise((resolve) => {
            new httpsClient({ url: `https://${this.url}/${method}`,
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
     * @description Получаем данные об авторе видео
     * @param id - ID канала
     * @param name - Название канала, если не будет найден канал будет возвращено название
     * @protected
     */
    protected restArtist = ({ id, name }: { id: string, name?: string }): Promise<APIRequestData.Artist> => {
        return new Promise((resolve) => {
            new httpsClient({
                url: `https:/${this.url}/channel/${id}/channels?flow=grid&view=0&pbj=1`,
                headers: Clients.WEB.request.context.client,
                agent: this.agent
            }).toJson.then((channel) => {
                if (channel instanceof Error) return resolve(null);

                const data = channel[1]?.response ?? channel?.response ?? null;
                const info = data?.header?.["c4TabbedHeaderRenderer"],
                    Channel = data?.metadata?.["channelMetadataRenderer"],
                    avatar = info?.avatar;

                return resolve({
                    title: Channel?.title ?? name ?? "Not found name",
                    url: `https://${this.url}/channel/${id}`,
                    image: avatar?.["thumbnails"].pop() ?? null
                });
            }).catch(() => resolve(null));
        });
    };

    /**
     * Извлекает JSON-данные из HTML-страницы YouTube и проверяет их на доступность воспроизведения.
     *
     * Метод пытается найти два стандартных маркера, используемых YouTube для встраивания
     * JSON-данных в HTML:
     * 1. `"var ytInitialPlayerResponse = "` – основной ответ плеера, содержащий информацию о видео,
     *    форматах, статусе воспроизведения и т.д.
     * 2. `"var ytInitialData = "` – общие данные страницы (используются, например, для плейлистов,
     *    рекомендаций).
     *
     * Если ни один из маркеров не найден или JSON не удалось распарсить, возвращается объект ошибки.
     * В случае успеха дополнительно проверяется поле `playabilityStatus.status`:
     * - Если статус отсутствует или равен `"OK"`, возвращается весь распарсенный JSON.
     * - Иначе создаётся ошибка с сообщением, содержащим причину (`playabilityStatus.reason`)
     *   или запасной текст `"Unknown playability status"`.
     *
     * @param input - Строка HTML-страницы, из которой нужно извлечь JSON.
     *
     * @returns Распарсенный JSON-объект (тип `json`) или экземпляр `Error`, если данные
     *          не найдены, повреждены или видео недоступно для воспроизведения.
     *
     * @protected
     */
    protected _extractResponse = (input: string): json | Error => {
        // Проверяем, что входные данные являются строкой. Если нет — возвращаем локализованную ошибку.
        if (typeof input !== "string")
            return locale.err("api.request.fail");

        // Пытаемся извлечь JSON с помощью одного из маркеров. Приоритет отдаётся
        // `ytInitialPlayerResponse`, так как он содержит более специфичные данные.
        const response =
            this._extractJson(input, "var ytInitialPlayerResponse = ") ??
            this._extractJson(input, "var ytInitialData = ");

        // Если JSON не был получен, возвращаем ошибку.
        if (!response) return locale.err("api.request.fail");

        // Проверяем статус воспроизведения.
        const status = response.playabilityStatus?.status;

        // Если статус задан и не равен "OK", значит видео недоступно.
        if (status && status !== "OK") {
            return Error(
                locale._(
                    locale.language,
                    "api.request.fail.msg",
                    [
                        response.playabilityStatus?.reason ??
                        "Unknown playability status"
                    ]
                )
            );
        }

        // Возвращаем JSON.
        return response;
    };

    /**
     * Извлекает и парсит JSON-объект, следующий за указанным текстовым маркером в HTML-странице.
     *
     * Алгоритм:
     * 1. Находит первое вхождение `marker`.
     * 2. Пропускает пробельные символы после маркера.
     * 3. Ожидает, что следующий символ — `{` (начало JSON-объекта). Если это не так, возвращает `null`.
     * 4. Посимвольно сканирует строку, отслеживая вложенность фигурных скобок (`depth`),
     *    учитывая строковые литералы (двойные и одинарные кавычки) и экранирование.
     * 5. Когда глубина становится равной нулю (найден конец корневого объекта), пытается
     *    распарсить подстроку от начала объекта до текущей позиции как JSON.
     * 6. Если парсинг успешен — возвращает объект, иначе `null`.
     *
     * Метод устойчив к наличию вложенных объектов, строк с фигурными скобками и кавычками.
     *
     * @param input - Строка HTML-страницы.
     * @param marker - Текстовый маркер, после которого ожидается JSON-объект.
     *
     * @returns JSON-объект или `null`, если маркер не найден или JSON повреждён.
     *
     * @private
     */
    private _extractJson(input: string, marker: string): json | null {
        // Ищем стартовую позицию маркера.
        const start = input.indexOf(marker);

        // Если маркер не найден, возвращаем null.
        if (start === -1)
            return null;

        // Указатель на позицию после маркера.
        let i = start + marker.length;

        // Пропускаем все пробельные символы (пробел, табуляция, перенос строки).
        while (i < input.length && /\s/.test(input[i]))
            i++;

        // Ожидаем открывающую фигурную скобку. Если её нет, это не JSON.
        if (input[i] !== "{")
            return null;

        // Переменные состояния парсера:
        let depth = 0;          // Текущая глубина вложенности фигурных скобок
        let quote = "";         // Текущий символ кавычки
        let escape = false;     // Флаг экранированного символа внутри строки

        // Запоминаем позицию начала объекта (для последующего slice).
        const begin = i;

        // Сканируем строку до конца.
        for (; i < input.length; i++) {
            const ch = input[i];

            // Если предыдущий символ был обратной косой чертой, пропускаем текущий символ
            // и сбрасываем флаг экранирования.
            if (escape) {
                escape = false;
                continue;
            }

            // Если мы внутри строкового литерала.
            if (quote) {
                if (ch === "\\") {
                    // Экранируем следующий символ.
                    escape = true;
                } else if (ch === quote) {
                    // Закрывающая кавычка — выходим из строкового режима.
                    quote = "";
                }
                // Внутри строки фигурные скобки не влияют на глубину.
                continue;
            }

            // Если встретили открывающую кавычку — входим в строковый режим.
            if (ch === '"' || ch === "'") {
                quote = ch;
                continue;
            }

            // Увеличиваем глубину при открывающей скобке.
            if (ch === "{") {
                depth++;
                continue;
            }

            // Уменьшаем глубину при закрывающей скобке.
            if (ch === "}") {
                depth--;

                // Если глубина стала нулевой, мы достигли конца корневого объекта.
                if (depth === 0) {
                    try {
                        // Пытаемся распарсить подстроку от начала объекта до текущей позиции включительно.
                        return JSON.parse(input.slice(begin, i + 1));
                    } catch {
                        // Если парсинг не удался (например, невалидный JSON), возвращаем null.
                        return null;
                    }
                }
            }
        }

        // Если цикл завершился, а глубина так и не стала нулевой — JSON неполный.
        return null;
    }
}

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
 * @private
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