import {API, Constructor} from "@handler";
import {httpsClient} from "@lib/request";
import {Track} from "@lib/player/queue";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description API ключ для доступа к видео на youtube
 * @protected
 */
const AIza_key = env.check("token.youtube") ? env.get("token.youtube") : "AIzaSyB-63vPrdThhKuerbB2N_l7Jswcxj6yUAc";

/**
 * @author SNIPPIK
 * @description Динамически загружаемый класс
 * @class sAPI
 * @public
 */
class sAPI extends Constructor.Assign<API.request> {
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
                new class extends API.item<"playlist"> {
                    public constructor() {
                        super({
                            name: "playlist",
                            filter: /playlist\?list=[a-zA-Z0-9-_]+/gi,
                            callback: (url: string, {limit}) => {
                                const ID = url.match(this.filter).pop();
                                let artist = null;

                                return new Promise<Track.playlist>(async (resolve, reject) => {
                                    //Если ID плейлиста не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID плейлиста!"));

                                    try {
                                        //Создаем запрос
                                        const details = await sAPI.API(`https://www.youtube.com/${ID}`);

                                        if (details instanceof Error) return reject(details);

                                        const sidebar: any[] = details["sidebar"]["playlistSidebarRenderer"]["items"];
                                        const microformat: any = details["microformat"]["microformatDataRenderer"];
                                        const items: Track[] = details["contents"]["twoColumnBrowseResultsRenderer"]["tabs"][0]["tabRenderer"]
                                            .content["sectionListRenderer"]["contents"][0]["itemSectionRenderer"]["contents"][0]["playlistVideoListRenderer"]["contents"]
                                            .splice(0, limit).map(({playlistVideoRenderer}) => sAPI.track(playlistVideoRenderer));

                                        //Если нет автора плейлиста, то это альбом автора
                                        if (sidebar.length > 1) {
                                            const authorData = details["sidebar"]["playlistSidebarRenderer"].items[1]["playlistSidebarSecondaryInfoRenderer"]["videoOwner"]["videoOwnerRenderer"];
                                            artist = await sAPI.getChannel({ id: authorData["navigationEndpoint"]["browseEndpoint"]["browseId"], name: authorData.title["runs"][0].text });
                                        } else artist = items.at(-1).artist;

                                        return resolve({
                                            url, title: microformat.title, items, artist,
                                            image: microformat.thumbnail["thumbnails"].pop()
                                        });
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных о треке
                 * @type track
                 */
                new class extends API.item<"track"> {
                    public constructor() {
                        super({
                            name: "track",
                            filter: /(watch|embed|youtu\.be|v\/)?([a-zA-Z0-9-_]{11})/gi,
                            callback: (url: string, { audio}) => {
                                const ID = this.filter.exec(url)?.at(0) ?? this.filter.exec(url)[0];

                                return new Promise<Track>(async (resolve, reject) => {
                                    //Если ID видео не удалось извлечь из ссылки
                                    if (!ID) return reject(Error("[APIs]: Не удалось получить ID трека!"));

                                    try {
                                        //Создаем запрос
                                        const result = await sAPI.API(ID, true);

                                        ///Если при получении данных возникла ошибка
                                        if (result instanceof Error) return reject(result);

                                        //Если надо получить аудио
                                        if (audio) {
                                            const format = await sAPI.extractFormat(result["streamingData"]);
                                            //console.log(format)

                                            result["videoDetails"]["format"] = {url: format["url"]};
                                        }

                                        const track = sAPI.track(result["videoDetails"]);
                                        return resolve(track);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        });
                    };
                },

                /**
                 * @description Запрос данных треков артиста
                 * @type author
                 */
                new class extends API.item<"author"> {
                    public constructor() {
                        super({
                            name: "author",
                            filter: /\/(channel)?(@)/gi,
                            callback: (url: string, {limit}) => {
                                return new Promise<Track[]>(async (resolve, reject) => {
                                    try {
                                        let ID: string;

                                        if (url.match(/@/)) ID = `@${url.split("@")[1].split("/")[0]}`;
                                        else ID = `channel/${url.split("channel/")[1]}`;

                                        //Создаем запрос
                                        const details = await sAPI.API(`https://www.youtube.com/${ID}/videos`);

                                        if (details instanceof Error) return reject(details);

                                        const author = details["microformat"]["microformatDataRenderer"];
                                        const tabs: any[] = details?.["contents"]?.["twoColumnBrowseResultsRenderer"]?.["tabs"];
                                        const contents = (tabs[1] ?? tabs[2])["tabRenderer"]?.content?.["richGridRenderer"]?.["contents"]
                                            ?.filter((video: any) => video?.["richItemRenderer"]?.content?.["videoRenderer"])?.splice(0, limit);

                                        //Модифицируем видео
                                        const videos = contents.map(({richItemRenderer}: any) => {
                                            const video = richItemRenderer?.content?.["videoRenderer"];

                                            return {
                                                url: `https://youtu.be/${video["videoId"]}`, title: video.title["runs"][0].text, duration: { full: video["lengthText"]["simpleText"] },
                                                author: { url: `https://www.youtube.com${ID}`, title: author.title }
                                            }
                                        });

                                        return resolve(videos);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        })
                    };
                },

                /**
                 * @description Запрос данных по поиску
                 * @type search
                 */
                new class extends API.item<"search"> {
                    public constructor() {
                        super({
                            name: "search",
                            callback: (url: string, {limit}): Promise<Track[] | Error> => {
                                return new Promise<Track[] | Error>(async (resolve, reject) => {
                                    try {
                                        //Создаем запрос
                                        const details = await sAPI.API(`https://www.youtube.com/results?search_query=${url.split(" ").join("+")}`);

                                        //Если при получении данных возникла ошибка
                                        if (details instanceof Error) return reject(details);

                                        let vanilla_videos = details["contents"]?.["twoColumnSearchResultsRenderer"]?.["primaryContents"]?.["sectionListRenderer"]?.["contents"][0]?.["itemSectionRenderer"]?.["contents"];

                                        if (vanilla_videos?.length === 0 || !vanilla_videos) return reject(Error(`[APIs]: Не удалось найти: ${url}`));

                                        let filtered_ = vanilla_videos?.filter((video: any) => video && video?.["videoRenderer"] && video?.["videoRenderer"]?.["videoId"])?.splice(0, limit);
                                        let videos: Track[] = filtered_.map(({ videoRenderer }: any) => sAPI.track(videoRenderer));

                                        return resolve(videos);
                                    } catch (e) { return reject(Error(`[APIs]: ${e}`)) }
                                });
                            }
                        })
                    };
                }
            ]
        });
    };

    /**
     * @description Получаем страницу и ищем на ней данные
     * @param ID - Ссылка на видео или ID видео
     * @param AIza - Использовать доступ к аудио через ключ
     */
    protected static API = (ID: string, AIza: boolean = false): Promise<Error | any> => {
        return new Promise((resolve) => {
            // Если надо использовать ключ доступа
            if (AIza) {
                new httpsClient(`https://www.youtube.com/youtubei/v1/player?key${AIza_key}&prettyPrint=false`, {
                    method: "POST",
                    body: JSON.stringify({
                        context: {
                            client: {
                                clientName: 'IOS',
                                clientVersion: '19.09.3',
                                deviceModel: 'iPhone14,3',
                                userAgent: 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
                                hl: 'en',
                                timeZone: 'UTC',
                                utcOffsetMinutes: 0
                            }
                        },
                        videoId: ID,
                        playbackContext: { contentPlaybackContext: { html5Preference: 'HTML5_PREF_WANTS' } },
                        contentCheckOk: true,
                        racyCheckOk: true
                    }),
                    headers: {
                        'X-YouTube-Client-Name': '5',
                        'X-YouTube-Client-Version': '19.09.3',
                        Origin: 'https://www.youtube.com',
                        'User-Agent': 'com.google.ios.youtube/19.09.3 (iPhone14,3; U; CPU iOS 15_6 like Mac OS X)',
                        'content-type': 'application/json'
                    }
                }).toJson.then((api) => {
                    //Если возникает ошибка при получении страницы
                    if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                    //Если есть статус, то проверяем
                    if (api["playabilityStatus"]?.status) {
                        if (api["playabilityStatus"]?.status === "LOGIN_REQUIRED") return resolve(Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`));
                        else if (api["playabilityStatus"]?.status !== "OK") return resolve(Error(`[APIs]: Не удалось получить данные! Status: ${api["playabilityStatus"]?.status}`));
                    }

                    return resolve(api);
                }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
                return;
            }

            // Если не надо использовать ключ, то делаем используем систему поиска данных по странице
            new httpsClient(ID, {useragent: true,
                headers: { "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7", "accept-encoding": "gzip, deflate, br" }
            }).toString.then((api) => {
                //Если возникает ошибка при получении страницы
                if (api instanceof Error) return resolve(Error("[APIs]: Не удалось получить данные!"));

                //Ищем данные на странице
                const data = this.extractInitialDataResponse(api);

                //Если возникает ошибка при поиске на странице
                if (data instanceof Error) return resolve(data);

                const html5Player = /<script\s+src="([^"]+)"(?:\s+type="text\/javascript")?\s+name="player_ias\/base"\s*>|"jsUrl":"([^"]+)"/.exec(api);
                Object.assign(data, { html5: `https://www.youtube.com${html5Player ? html5Player[1] || html5Player[2] : null}`});

                return resolve(data);
            }).catch((err) => resolve(Error(`[APIs]: ${err}`)));
        });
    };

    /**
     * @description Получаем данные из страницы
     * @param input {string} Страница
     */
    protected static extractInitialDataResponse = (input: string): any | Error | null => {
        const startPattern: string = input.match("var ytInitialPlayerResponse = ") ? "var ytInitialPlayerResponse = " : "var ytInitialData = ";
        const startIndex = input.indexOf(startPattern);
        const endIndex = input.indexOf("};", startIndex + startPattern.length);

        //Если нет данных
        if (startIndex === -1 && endIndex === -1) return null;

        const data = JSON.parse(input.substring(startIndex + startPattern.length, endIndex + 1));

        //Если при получении данных происходит что-то не так
        if (!data) return Error("[APIs]: Не удалось получить данные!");

        //Если есть статус, то проверяем
        if (data["playabilityStatus"]?.status) {
            if (data["playabilityStatus"]?.status === "LOGIN_REQUIRED") return Error(`[APIs]: Данное видео невозможно включить из-за проблем с авторизацией!`);
            else if (data["playabilityStatus"]?.status !== "OK") return Error(`[APIs]: Не удалось получить данные! Status: ${data["playabilityStatus"]?.status}`);
        }

        return data;
    };

    /**
     * @description Получаем аудио дорожки
     * @param data {any} <videoData>.streamingData
     */
    protected static extractFormat = (data: any) => {
        return new Promise(async (resolve) => {
            // Проверяем все форматы аудио и видео
            for (const format of (data["adaptiveFormats"])) {
                if (!format.url) continue;

                // Если это аудио, то проверяем его
                else if (format.mimeType.match(/opus|audio/) && !format.mimeType.match(/ec-3/)) {
                    if (!format.url.startsWith("https")) format.url = format.url.split("https://")[1];
                    return resolve(format);
                }
            }
        });
    };

    /**
     * @description Получаем данные о пользователе
     * @param id {string} ID канала
     * @param name {string} Название канала
     */
    protected static getChannel = ({ id, name }: { id: string, name?: string }): Promise<Track.artist> => {
        return new Promise<Track.artist>((resolve) => {
            new httpsClient(`https://www.youtube.com/channel/${id}/channels?flow=grid&view=0&pbj=1`, {
                headers: {
                    "x-youtube-client-name": "1",
                    "x-youtube-client-version": "2.20201021.03.00",
                    "accept-language": "en-US,en;q=0.9,en-US;q=0.8,en;q=0.7",
                    "accept-encoding": "gzip, deflate, br"
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
     * @param track {any} Видео
     */
    protected static track(track: any): any {
        try {
            return new Track({
                url: `https://youtu.be/${track["videoId"]}`,
                title: track.title?.["runs"][0]?.text ?? track.title,
                artist: {
                    title: track["shortBylineText"]["runs"][0].text ?? track.author ?? undefined,
                    url: `https://www.youtube.com${track["shortBylineText"]["runs"][0]["navigationEndpoint"]["browseEndpoint"]["canonicalBaseUrl"] || track["shortBylineText"]["runs"][0]["navigationEndpoint"]["commandMetadata"]["webCommandMetadata"].url}`,
                },
                time: { total: track["lengthSeconds"] ?? track["lengthText"]?.["simpleText"] ?? 0 },
                image: track.thumbnail["thumbnails"].pop(),
                audio: {
                    type: "url",
                    url: track?.format?.url || undefined,
                }
            });
        } catch {
            return new Track({
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
                audio: {
                    type: "url",
                    url: track?.format?.url || undefined
                }
            })
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ sAPI });