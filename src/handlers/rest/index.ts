import {APIPlatformType, APIRequests, APIRequestsKeys} from "#handler/rest/index.decorator";
import {Logger, SimpleWorker} from "#structures";
import type {RestServerSide} from "./index.server";
import {RestClientSide} from "./index.client";
import {Worker} from "node:worker_threads";
import {Track} from "#core/queue";

// Export decorator
export * from "./index.decorator";
export * from "./index.client";
export * from "./index.server";

/**
 * @author SNIPPIK
 * @description Разделение слов в названии трека
 * @param str - Название
 * @const normalize
 * @private
 */
const normalize = (str: string) => new Set(str.toLowerCase().replace(/[*:/;-]/gi, "").replace(/\s+/g, " ").trim().split(" "));

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
    public platformMap = new Map<string, RestServerSide.API>();

    /**
     * @description Map функций для возврата ответа от worker
     * @private
     */
    private pending = new Map<number, {
        // Функция ответа
        resolve: (val: RestServerSide.Result<any> & { requestId?: number }) => void,

        // Время ожидания
        timeout: NodeJS.Timeout
    }>();

    /**
     * @description Получаем список всех доступных платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get array(): RestServerSide.API[] {
        if (!this.platforms.array) this.platforms.array = this.platforms.authorization.map(name => {
            const platform = this.platformMap.get(name);
            return platform.type === APIPlatformType.primary ? platform : null;
        }).filter(Boolean);
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
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public startWorker = async (): Promise<boolean> => {
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
                    this.platformMap.clear();

                    // Заполняем Map для O(1) доступа
                    for (const api of Object.values(data.supported)) {
                        if (api.auth !== null) {
                            this.platformMap.set(api.name.toUpperCase(), api);
                        }
                    }

                    // Сбрасываем уникальный id запроса
                    this.generateUniqueId();
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

            // Внутри startWorker, после создания this.worker
            worker.on("message", (message: RestServerSide.Result<any> & { requestId?: number }) => {
                const { requestId } = message;

                // Ищем, кто ждет этот ID
                const request = this.pending.get(requestId);
                if (!request) return; // Если никто не ждет (например, уже был таймаут)

                // Сразу чистим таймер и удаляем из карты
                clearTimeout(request.timeout);
                this.pending.delete(requestId);

                // Обработка результата
                request.resolve(message);
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
        if (!name) return this.platformMap.get("YOUTUBE");

        const upperName = name.toUpperCase();

        // Попытка O(1) поиска по точному имени
        const directMatch = this.platformMap.get(upperName);
        if (directMatch) return directMatch;

        // Если не нашли, делаем ОДИН проход для проверки RegExp
        const regexMatch = this.array.find((api) => api.filter.test(name));
        if (regexMatch) return regexMatch;

        // Fallback к дефолтной платформе
        return this.platformMap.get("YOUTUBE");
    };

    /**
     * @description Создание класса для взаимодействия с платформой, рекомендуются добавлять timeout из-вне
     * @returns Promise<APIRequests[T] | Error>
     * @protected
     */
    public request_worker<T extends APIRequestsKeys>({platform, payload, options, type}: RestClientSide.ClientOptions): Promise<APIRequests<T>| Error> {
        return new Promise<APIRequests<T> | Error>((resolve) => {
            const requestId = this.generateUniqueId();

            // Создаем таймаут
            const timeout = setTimeout(() => {
                if (this.pending.has(requestId)) {
                    this.pending.delete(requestId);
                    resolve(new Error(`Connection to platform ${platform.name} timeout`));
                }
            }, 20e3);

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
                            Logger.log("DEBUG", `[Rest/API |${type}| GET - ${platform.name}]: ${payload}`);
                            const parseTrack = (item) => new Track(item, platform);

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
                },
                timeout
            });

            // Отправляем запрос
            this.worker.postMessage({ platform: platform.name, payload, options, requestId, type });
        });
    };


    /**
     * @description Ищем похожий трек, но на других платформах
     * @param track - Трек который надо найти
     * @param array - Список платформ для поиска
     * @returns Promise<Track | Error>
     * @private
     */
    private fetch = async (track: Track, array: RestServerSide.API[]): Promise<Track | Error> => {
        const { name, artist, api } = track;

        // Оригинальный трек по словам
        const original = normalize(`${artist.title} ${name}`);
        let link: Track = null, lastError: Error;

        // Ищем нужную платформу
        for (const platform of array) {
            // Не учитываем платформу трека
            if (platform.name === api.name) continue;

            // Получаем класс для работы с Worker
            const platformAPI = this.request(platform.name);

            // Поиск трека
            const search = await platformAPI.request<"search">(`${artist.title} ${name}`).request();

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
                const timeDiff = Math.abs(track.time.total - song.time.total);
                if (timeDiff > 3) return false;

                // ВАЖНО: Для кандидата нам нужен МАССИВ слов, чтобы matchCount был точным.
                // Если твой глобальный normalize возвращает Set,
                // то для кандидата лучше сделать быстрый сплит:
                const candidateWords = song.artist.title.toLowerCase()
                    .replace(/[*:/;-]/gi, "")
                    .split(/\s+/);

                if (candidateWords.length === 0) return false;

                let matchCount = 0;
                for (const word of candidateWords) {
                    // Теперь используем .has() у твоего Set
                    if (original.has(word)) {
                        matchCount++;
                    }
                }

                // Логика порогов
                const isFullMatch = matchCount === candidateWords.length;
                const isPartialMatch = matchCount >= Math.floor(candidateWords.length * 0.4);

                return isFullMatch || isPartialMatch;
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
                    track["_duration"] = song.time;
                    track.link = song.link;
                    return song;
                }

                // Пробуем найти что-то похожее, но на другой платформе
            }

            // Ищем похожий трек на другой платформе
            const song = await this.fetch(track, this.arrayAudio);

            // Если получена ошибка
            if (song instanceof Error) return song;

            track["_duration"] = song.time;
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