import { Logger, SimpleWorker } from "#structures";
import type { RestServerSide } from "./index.server";
import { RestClientSide } from "./index.client";
import { Worker } from "node:worker_threads";
import { Track } from "#core/queue";

// Export decorator
export * from "./index.decorator";
export * from "./index.client";
export * from "./index.server";

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequests
 * @helper
 */
export type APIRequests = {
    track: Track
    playlist: Track.list
    album: Track[]
    artist: Track[]
    related: Track.list
    search: Track[]
}

/**
 * @description Helper: all possible requests across platforms
 * @type APIRequestsRaw
 * @helper
 */
export type APIRequestsRaw = {
    track: TrackRaw.Data
    playlist: TrackRaw.List
    album: TrackRaw.List
    artist: TrackRaw.Data[]
    related: TrackRaw.List
    search: TrackRaw.Data[]
}

/**
 * @description Сырые типы данных для дальнейшего использования
 * @namespace TrackRaw
 * @helper
 */
namespace TrackRaw {
    export interface Data {
        readonly id: string;
        title: string;
        readonly url: string;
        artist: { title: string; readonly url: string; image?: string }
        image: string;
        time: { total: string; split?: string }
        audio?: string;
    }

    export interface List {
        readonly url: string;
        readonly title: string;
        items: Data[];
        image: string;
        artist?: { title: string; readonly url: string; image?: string }
    }
}

/**
 * @author SNIPPIK
 * @description Коллекция базы данных для взаимодействия с Rest/API
 * @class RestObject
 * @public
 */
export class RestObject {
    /**
     * @description Второстепенный поток, динамически создается и удаляется когда не требуется
     * @readonly
     * @private
     */
    private worker: Worker;

    /**
     * @description Последний уникальный ID запроса
     * @private
     */
    private lastID: number;

    /**
     * @description База с платформами
     * @public
     */
    public platforms: RestServerSide.Data;

    /**
     * @description Получаем список всех доступных платформ
     * @public
     */
    public get array(): RestServerSide.API[] {
        if (!this.platforms?.array) this.platforms.array = Object.values(this.platforms.supported).filter(api => api.auth !== null);
        return this.platforms.array;
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get arrayAudio(): RestServerSide.API[] {
        return this.array.filter(api => api.audio !== false && !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к похожим трекам
     * @returns RestServerSide.API[]
     * @public
     */
    public get arrayRelated(): RestServerSide.API[] {
        return this.array.filter(api => api.requests.some((apis) => apis.name === "related"));
    };

    /**
     * @description Генерация уникального ID
     * @param reset
     */
    private generateUniqueId = (reset = false) => {
        // Если надо сбросить данные
        if (reset) {
            this.lastID = 0;
            return this.lastID;
        }

        // Если большое кол-во запросов
        else if (this.lastID >= 2 ** 16) this.generateUniqueId(true);

        this.lastID += 1;
        return this.lastID;
    };

    /**
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public startWorker = async (): Promise<boolean> => {
        return new Promise(resolve => {
            const worker = this.worker = SimpleWorker.create<RestServerSide.Data>({
                file: __dirname + "/index.worker",
                options: {
                    execArgv: ["-r", "tsconfig-paths/register"],
                    workerData: { rest: true },
                },
                postMessage: { data: true },
                not_destroyed: true,
                callback: (data) => {
                    this.platforms = data;

                    // Сбрасываем уникальный id запроса
                    this.generateUniqueId(true);
                    return resolve(true);
                }
            });

            // Если возникнет ошибка, пересоздадим worker
            worker.once("error", (error) => {
                if (this.lastID >= 5) throw error;
                else console.log(error);

                this.lastID++;
                return this.startWorker();
            });
        });
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @public
     */
    public request = (name: RestServerSide.API["name"] | string): RestClientSide.Request => {
        return new RestClientSide.Request(this.platform(name));
    };

    /**
     * @description Получаем платформу
     * @param name - Имя платформы
     * @private
     */
    private platform = (name: RestServerSide.API["name"] | string): RestServerSide.API => {
        return this.platforms.supported[name] ?? this.array.find((api) => api.name === name || api.filter.exec(name) || api.name === "YOUTUBE");
    };

    /**
     * @description Ищем похожий трек, но на других платформах
     * @param track - Трек который надо найти
     * @param array - Список платформ для поиска
     * @returns Promise<Track | Error>
     * @private
     */
    private fetch = async (track: Track, array: RestServerSide.API[]): Promise<Track | Error> => {
        const { name, artist } = track;

        // Оригинальный трек по словам
        const original = name.toLowerCase().replace(/[^\w\s:;]|_/gi, "").replace(/\s+/gi, " ").split(" ");
        let link: Track = null, lastError: Error;

        // Ищем нужную платформу
        for (const platform of array) {
            // Получаем класс для работы с Worker
            const platformAPI = this.request(platform.name);

            // Поиск трека
            const search = await platformAPI.request<"search">(`${name} ${artist.title}`).request();

            // Если при получении треков произошла ошибка
            if (search instanceof Error) {
                Logger.log("ERROR", search);
                lastError = search;
                continue;
            }

            // Если треков не найдено
            else if (!search.length) {
                Logger.log("ERROR", `[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                lastError = Error(`[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                continue;
            }

            // Ищем нужный трек
            // Можно разбить проверку на слова, сравнивать кол-во совпадений, если больше половины то точно подходит
            const findTrack = search.find((song) => {
                const candidate = song.name.toLowerCase().replace(/[^\w\s:;]|_/gi, "").replace(/\s+/gi, " ").split(" ");
                const Match = candidate.filter((name, i) => name === original[i]).every((word, i) => word === original[i]);
                const time = Math.abs(track.time.total - song.time.total);

                return (time <= 5 || time === 0) && Match;
            });

            // Если отфильтровать треки не удалось
            if (!findTrack) {
                Logger.log("ERROR", `[APIs/${platform.name}/fetch] The tracks found do not match the description of this`);
                lastError = Error(`[APIs/${platform.name}] The tracks found do not match the description of this`);
                continue;
            }

            // Получение исходника
            const song = await platformAPI.request<"track">(findTrack["url"]).request();

            // Если при получении трека произошла ошибка
            if (song instanceof Error) {
                Logger.log("ERROR", song);
                lastError = song;
                continue;
            }

            // Если есть ссылка на аудио
            if (song.link) {
                // Меняем время трека на время найденного трека
                track["_duration"] = song.time;

                // Выносим ссылку из цикла
                link = song;
                break;
            }
        }

        // Если нет ссылки на исходный аудио файл
        if (!link) {
            // Если во время поиска произошла ошибка
            if (lastError) return lastError;

            // Если нет ошибки и ссылки
            else if (!lastError) return Error(`[APIs/fetch] There were no errors and there are no audio links to the resource`);

            // Если нет ссылки
            return Error(`[APIs/fetch] Unable to get audio link on alternative platforms!`);
        }

        return link;
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @returns Promise<string | Error>
     * @public
     */
    public fetchAudioLink = async (track: Track): Promise<string | Error> => {
        const { url, api } = track;
        const { authorization, audio, block } = this.platforms;

        try {
            // Если платформа поддерживает получение аудио и может получать данные
            if (authorization.includes(api.name) && audio.includes(api.name) && !block.includes(api.name)) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();

                // Если получили ошибку
                if (song instanceof Error) return null;

                track["_duration"] = song.time;
                return song.link;
            }

            const song = await this.fetch(track, this.arrayAudio);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return song.link;
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Если надо найти похожий трек/и на другой платформе
     * @param track - Трек для которого надо найти похожий
     * @returns Promise<Track[] | Error>
     * @public
     */
    public fetchRelatedTracks = async (track: Track): Promise<Track[] | Error> => {
        const { url, api, name, artist } = track;
        const { related } = this.platforms;

        try {
            // Если платформа умеет сама выдавать похожие треки
            if (related.includes(api.name)) {
                const item = await this.request(api.name).request<"related">(`${url}&list=RD`, {audio: true}).request();

                // Если не нашлись похожие треки, то делаем поиск
                if (!item?.["items"] || item instanceof Error) {
                    const items = await this.request(api.name).request<"search">(`${name} ${artist.title}`).request();

                    // Если получили ошибку
                    if (items instanceof Error) {
                        Logger.log("ERROR", items);
                        return null;
                    }

                    // Ищем оригинальный трек
                    const org = items.find((trk) => trk.name === name);

                    // Если есть оригинальный трек
                    if (org) items.splice(items.indexOf(org), 1);

                    return items;
                }

                // Отдаем найденные треки
                return item.items;
            }

            const song = await this.fetch(track, this.arrayRelated);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return this.fetchRelatedTracks(song);
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };

    /**
     * @description Создание класса для взаимодействия с платформой, рекомендуются добавлять timeout из-вне
     * @returns Promise<APIRequests[T] | Error>
     * @protected
     */
    protected request_worker<T extends keyof APIRequests>({platform, payload, options, type}: RestClientSide.ClientOptions): Promise<APIRequests[T] | Error> {
        return new Promise((resolve) => {
            const requestId = this.generateUniqueId(); // Генерируем номер запроса

            // Слушаем сообщение или же ответ
            const onMessage = (message: RestServerSide.Result<T> & { requestId?: string }) => {
                // Не наш ответ — игнорируем
                if (message.requestId !== requestId) return;

                // Отписываемся после получения
                this.worker.off("message", onMessage);

                const { result, status } = message;

                // Если получена ошибка
                if (result instanceof Error) {
                    // Если платформа не отвечает, то отключаем ее!
                    if (/Connection Timeout/.test(result.message) || /Fail getting client ID/.test(result.message)) {
                        this.platforms.block.push(platform.name);
                    }

                    return resolve(result);
                }

                // Если получен успешный ответ
                else if (status === "success") {
                    const parseTrack = (item: TrackRaw.Data) => new Track(item, platform);

                    // Если пришел список треков
                    if (Array.isArray(result)) {
                        return resolve(result.map(parseTrack) as APIRequests[T]);
                    }

                    // Если пришел плейлист
                    else if (typeof result === "object" && "items" in result) {
                        return resolve({ ...result, items: result.items.map(parseTrack) } as any);
                    }

                    // Если просто трек
                    return resolve(parseTrack(result) as APIRequests[T]);
                }

                return resolve(null);
            };

            // Слушаем worker
            this.worker.on("message", onMessage);

            // Отправляем запрос
            this.worker.postMessage({ platform: platform.name, payload, options, requestId, type });
        });
    };
}