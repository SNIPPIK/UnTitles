import { APIPlatformType, APIRequestData, APIRequests, APIRequestsKeys } from "#handler/rest/index.decorator";
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
 * @author SNIPPIK
 * @description Разделение слов в названии трека
 * @param text - Название
 * @const normalize
 * @private
 */
const normalize = (text: string) => text
    .toLowerCase()
    .normalize("NFKD")
    // Оставляем только буквы и цифры, заменяя остальное на пробелы
    .replace(/[^\p{L}\p{N}\s]/gui, "")
    .trim();


/**
 * @author SNIPPIK
 * @description Ищет треки из кучи мусорного текста
 * @param original - Оригинальное название
 * @param candidate - Название кандидата
 * @private
 */
const getSmartMatch = (original: string, candidate: string) => {
    // Разбиваем оригинал на массив слов и берем только важные (длина > 2)
    const words = original.split(/\s+/).filter(word => word.length > 2);

    if (words.length === 0) return false;

    // Создаем регулярку с Lookahead для каждого слова
    // Она сработает, только если ВСЕ слова присутствуют в строке в любом порядке
    const pattern = new RegExp(`^${words.map(w => `(?=.*${w})`).join("")}.*$`, "i");
    return pattern.test(candidate);
};

/**
 * @author SNIPPIK
 * @description Коллекция базы данных для взаимодействия с Rest/API
 * @class RestObject
 * @public
 */
export class RestObject {
    /**
     * @description Второстепенный поток, динамически создается и удаляется когда не требуется
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
     * @description База с платформами в Map
     * @public
     */
    public map = new Map<string, RestServerSide.API>();

    /**
     * @description Map функций для возврата ответа от worker
     * @private
     */
    private pending = new Map<number, {
        // Функция ответа
        resolve: (val: RestServerSide.Result<any> & { requestId?: number }) => void
    }>();

    /**
     * @description Получение случайной платформы
     * @private
     */
    private get random(): RestServerSide.API | null {
        const map = this.arrayAuth;
        if (map.length === 0) return null;

        const index = Math.floor(Math.random() * map.length);
        return map[index];
    };

    /**
     * @description Получаем список всех платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get array(): RestServerSide.API[] {
        if (!this.platforms.array) {
            this.platforms.array = Object.values(this.platforms.supported)
                .filter(api => api.type === APIPlatformType.primary)
                .sort((a, b) => a.name.localeCompare(b.name));
        }
        return this.platforms.array;
    };

    /**
     * @description Получаем список всех доступных платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get arrayAuth(): RestServerSide.API[] {
        return this.array.filter(api => api.auth !== null);
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get arrayAudio(): RestServerSide.API[] {
        return this.array
            .filter(api => api.audio !== false && !this.platforms.block.includes(api.name));
    };

    /**
     * @description Платформы с доступом к похожим трекам
     * @returns RestServerSide.API[]
     * @public
     */
    public get arrayRelated(): RestServerSide.API[] {
        return this.array
            .filter(api => api.requests?.some(req => req.name === "related"));
    };

    /**
     * @description Создание класса для взаимодействия с платформой
     * @returns RestClientSide.Request
     * @public
     */
    public request = (name: RestServerSide.API["name"] | string): RestClientSide.Request => {
        return new RestClientSide.Request(this.platform(name));
    };

    /**
     * @description Получаем платформу
     * @param name - Имя платформы
     * @returns RestServerSide.API
     * @private
     */
    private platform = (name: RestServerSide.API["name"] | string): RestServerSide.API => {
        if (!name) return this.random;

        const upperName = name.toUpperCase();

        // Попытка O(1) поиска по точному имени
        const directMatch = this.map.get(upperName);
        if (directMatch) return directMatch;

        // Если не нашли, делаем ОДИН проход для проверки RegExp
        const regexMatch = this.array.find((api) => api.filter.test(name));
        if (regexMatch) return regexMatch;

        // Fallback к дефолтной платформе
        return this.map.get("YOUTUBE") ?? this.random;
    };

    /**
     * @description Создание класса для взаимодействия с платформой, рекомендуются добавлять timeout из-вне
     * @returns Promise<APIRequests[T] | Error>
     * @protected
     */
    public request_worker<T extends APIRequestsKeys>({platform, payload, options, type}: RestClientSide.ClientOptions): Promise<APIRequests<T>| Error> {
        return new Promise<APIRequests<T> | Error>((resolve) => {
            const requestId = this.generateUniqueId();

            // Регистрируем "ждущего"
            this.pending.set(requestId, {
                resolve: (message) => {
                    const { result, status } = message;

                    /**
                     * @description Слушаем статус ответа другого потока
                     * @private
                     */
                    switch (status) {
                        // Если получен успешный ответ
                        case "success": {
                            Logger.log("DEBUG", `[Rest/API |${type}| GET  - ${platform.name}]: ${payload}`);
                            const parseTrack = (item: APIRequestData.Track) => new Track(item, platform);

                            // Если пришел список треков
                            if (Array.isArray(result)) {
                                return resolve(result.map(parseTrack) as APIRequests<T>);
                            }

                            // Если пришел плейлист
                            else if (typeof result === "object" && "items" in result) {
                                return resolve({ ...result, items: result.items.map(parseTrack) } as any);
                            }

                            // Если просто трек
                            return resolve(parseTrack(result) as APIRequests<T>);
                        }

                        // Если была получена ошибка
                        case "error": {
                            Logger.log("ERROR", result);

                            // Если платформа не отвечает, то отключаем ее!
                            if (/Connection Timeout/.test(result.message) || /Fail getting client ID/.test(result.message)) {
                                // Блочим платформу
                                this.platforms.block.push(platform.name);
                            }

                            return resolve(result);
                        }

                        // Если получен неожиданный ответ
                        default: {
                            Logger.log("WARN", `An unknown response was received from another thread!`);
                            return resolve(new Error(`Unknown response!!!`))
                        }
                    }
                }
            });

            // Отправляем запрос
            this.worker.postMessage({ platform: platform.name, payload, options, requestId, type });
            Logger.log("DEBUG", `[Rest/API |${type}| SEND - ${platform.name}]: ${payload}`);
        });
    };

    /**
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public startWorker = (): Promise<boolean> => {
        return new Promise(resolve => {
            // Создаем поток через менеджер потоков
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
                    this.map.clear();

                    // Заполняем Map для O(1) доступа
                    for (const api of this.array) {
                        if (api.auth !== null) {
                            this.map.set(api.name.toUpperCase(), api);
                        }
                    }

                    // Сбрасываем уникальный id запроса
                    this.lastID = 0;
                    return resolve(true);
                }
            });

            // Если возникнет ошибка, пересоздадим worker
            worker.once("error", (error) => {
                console.log(error);

                // Делам небольшую задержку для запуска
                setTimeout(() => {
                    return this.startWorker();
                }, 2e3);
            });

            // Внутри startWorker, после создания this.worker
            worker.on("message", (message: RestServerSide.Result<any> & { requestId?: number }) => {
                const { requestId } = message;

                // Ищем, кто ждет этот ID
                const request = this.pending.get(requestId);
                if (!request) return; // Если никто не ждет (например, уже был тайм-аут)

                // Обработка результата
                request.resolve(message);
                this.pending.delete(requestId);
            });
        });
    };

    /**
     * @description Генерация уникального ID
     * @returns number
     * @private
     */
    private generateUniqueId = () => {
        this.lastID = (this.lastID + 1) % 65536; // 2^16
        return this.lastID;
    };

    /**
     * @description Ищем похожий трек, но на других платформах
     * @param track - Трек который надо найти
     * @param array - Список платформ для поиска
     * @returns Promise<Track | Error>
     * @private
     */
    private fetch = (track: Track, array: RestServerSide.API[]): Promise<Track | Error> => {
        const { name, artist, api } = track;
        const original_name = `${artist.title} ${name}`;
        const original = normalize(original_name);

        // Формируем массив обещаний для каждой платформы (кроме исходной)
        const platformPromises = array
            .filter(platform => platform.name !== api.name)
            .map(async (platform) => {
                const platformAPI = this.request(platform.name);

                // Параллельный поиск по названию
                const search = await platformAPI.request<"search">(original_name).request();

                // Если при получении треков произошла ошибка
                if (search instanceof Error) {
                    Logger.log("ERROR", search);
                    throw search;
                }

                // Если треков не найдено
                else if (!search.length) {
                    const err = Error(`[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                    Logger.log("ERROR", err);
                    throw err;
                }

                // Фильтрация треков по длительности и совпадению слов
                const findTrack = search.find((song) => {
                    const candidate = normalize(`${song.artist.title} ${song.name}`);
                    const timeDiff = Math.abs(track.time.total - song.time.total);
                    const candidateArr = candidate.split(/\s+/).filter(Boolean);
                    const matchCount = candidateArr.filter(word => original.includes(word)).length;

                    return (timeDiff <= 5) && (getSmartMatch(original, candidate) || matchCount >= Math.floor(candidateArr.length * 0.75));
                });

                // Если отфильтровать треки не удалось
                if (!findTrack) {
                    const err = Error(`[APIs/${platform.name}] The tracks found do not match the description of this`);
                    Logger.log("ERROR", err);
                    throw err;
                }

                // Получение деталей трека (ссылки)
                const song = await platformAPI.request<"track">(findTrack["url"]).request();

                // Если при получении трека произошла ошибка
                if (song instanceof Error) {
                    Logger.log("ERROR", song);
                    throw song;
                }

                // Если нет ссылки на исходный файл
                else if (!song.link) {
                    throw Error(`[APIs/${platform.name}] No audio link available`);
                }

                // Возвращаем успешный результат
                track["_duration"] = song.time;
                return song;
            });

        try {
            // Ждём первый успешный результат (или ошибку, если все упали)
            return Promise.any(platformPromises);
        } catch (aggregateError) {
            const errors = (aggregateError as AggregateError).errors;
            return errors[errors.length - 1] || Error(`[APIs/fetch] Unable to get audio link on alternative platforms!`);
        }
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы, получаем с другой
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @returns Promise<string | Error>
     * @public
     */
    public fetchAudioLink = async (track: Track): Promise<Track | Error> => {
        const { url, api } = track;
        const { authorization, audio, block } = this.platforms;

        try {
            // Если платформа поддерживает получение аудио и может получать данные
            if (authorization.includes(api.name) && audio.includes(api.name) && !block.includes(api.name)) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();

                // Если удалось получить аудио
                if (!(song instanceof Error)) {
                    track.link = song.link;
                    return song;
                }

                // Пробуем найти что-то похожее, но на другой платформе
            }

            // Ищем похожий трек на другой платформе
            const song = await this.fetch(track, this.arrayAudio);

            // Если получена ошибка
            if (song instanceof Error) return song;

            track.link = song.link;
            return song;
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
                return item.items as any;
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
}