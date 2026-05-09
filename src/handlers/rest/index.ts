import {
    APIPlatformType,
    APIRequestData,
    APIRequests,
    APIRequestsKeys,
    RestAPINames
} from "#handler/rest/index.decorator.js";
import type { RestServerSide } from "./index.server.js";
import { Logger, SimpleWorker } from "#structures";
import { RestClientSide } from "./index.client.js";
import { Worker } from "node:worker_threads";
import { Track } from "#core/queue/index.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Export decorator
export * from "./index.decorator.js";
export * from "./index.client.js";
export * from "./index.server.js";

/**
 * @author SNIPPIK
 * @description Класс запускающий систему Worker/RestAPI
 * @class RestWorker
 * @private
 */
class RestWorker<T extends APIRequestsKeys> {
    /**  Второстепенный поток, динамически создается и удаляется когда не требуется */
    protected worker: Worker;

    /** Последний уникальный ID запроса */
    protected lastID: number = 0;

    /** База с платформами */
    protected platforms: RestServerSide.Data;

    /** База с платформами в Map */
    public map = new Map<string, RestServerSide.API>();

    /** Map функций для возврата ответа от worker  */
    protected pending = new Map<number, {
        // Функция ответа
        resolve: (val: RestServerSide.Result<T> & { requestId?: number }) => void
    }>();

    /**
     * @description Получаем список всех платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get array(): RestServerSide.API[] {
        if (!this.platforms.array) {
            this.platforms.array = Object.values(this.platforms.supported)
                .sort((a, b) => a.name.localeCompare(b.name));
        }
        return this.platforms.array;
    };

    /**
     * @description Получаем список всех доступных платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get array_auth(): RestServerSide.API[] {
        return this.array_prev.filter(api => api.auth !== null);
    };

    /**
     * @description Платформы с доступом к аудио
     * @returns RestServerSide.API[]
     * @public
     */
    public get array_audio(): RestServerSide.API[] {
        return this.array_prev
            .filter(api => !this.platforms.block.includes(api.name) && this.platforms.audio.includes(api.name));
    };

    /**
     * @description Получаем список всех не технических платформ
     * @returns RestServerSide.API[]
     * @public
     */
    public get array_prev(): RestServerSide.API[] {
        if (!this.platforms.array_tex) {
            this.platforms.array_tex = Object.values(this.platforms.supported)
                .filter(api => api.type === APIPlatformType.primary && api.auth !== null)
                .sort((a, b) => a.name.localeCompare(b.name));
        }

        return this.platforms.array_tex;
    };

    /**
     * @description Платформы с доступом к похожим трекам
     * @returns RestServerSide.API[]
     * @public
     */
    public get array_related(): RestServerSide.API[] {
        return this.array_prev
            .filter(api => api.requests?.some(req => req.name === "related"));
    };

    /**
     * @description Общее кол-во методов запросов
     * @public
     */
    public get methods() {
        let reqs = 0;

        for (let i of this.array) {
            reqs += i.requests.length;
        }

        return reqs;
    };

    public constructor() {};

    /**
     * @description Заблокирована ли платформа?
     * @param platform
     * @public
     */
    public hasBlocked = (platform: RestAPINames) => {
        return this.platforms.block.includes(platform);
    };

    /**
     * @description Функция для инициализации worker
     * @returns Promise<boolean>
     * @public
     */
    public init = (): Promise<boolean> => {
        return new Promise(async (resolve) => {
            // Если поток уже есть в системе
            if (this.worker) await this.cleanup();

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);

            // Создаем поток через менеджер потоков
            const worker = this.worker = SimpleWorker.create<RestServerSide.Data>({
                file: __dirname + "/index.worker",
                options: {
                    execArgv: [
                        "--experimental-require-module",
                        "--enable-source-maps"
                    ],
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

                    return resolve(true);
                }
            });

            // Если возникнет ошибка, пересоздадим worker
            worker.once("error", (error) => {
                console.log(error);

                // Делам небольшую задержку для запуска
                setTimeout(() => {
                    return this.init();
                }, 2e3);
            });

            // Внутри startWorker, после создания this.worker
            worker.on("message", (message: RestServerSide.Result<T> & { requestId?: number }) => {
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
     * @description Получение случайной платформы
     * @protected
     */
    protected get random(): RestServerSide.API | null {
        const map = this.array_auth;
        if (map.length === 0) return null;

        const index = Math.floor(Math.random() * map.length);
        return map[index];
    };

    /**
     * @description Генерация уникального ID
     * @returns number
     * @protected
     */
    protected generateUniqueId = () => {
        this.lastID = (this.lastID + 1) % 65536; // 2^16
        return this.lastID;
    };

    /**
     * @description Удаление всех компонентов системы Rest/API
     * @public
     */
    public cleanup = async () => {
        // Удаляем функции ожидания
        this.pending.clear();
        this.pending = null;

        // Если поток уже есть в системе
        if (this.worker) {
            await this.worker.terminate();
            this.worker = null;
        }

        this.platforms = null;
        this.lastID = 0;
    };
}

/**
 * @author SNIPPIK
 * @description Коллекция базы данных для взаимодействия с Rest/API
 * @class RestObject
 * @extends RestWorker
 * @public
 */
export class RestObject extends RestWorker<APIRequestsKeys> {
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
        const regexMatch = this.array.find((api) => api.filter?.test?.(name) || api.name === upperName);
        if (regexMatch) return regexMatch;

        // Fallback к дефолтной платформе
        return this.map.get("YOUTUBE") ?? this.random;
    };

    /**
     * @description Создание класса для взаимодействия с платформой, рекомендуются добавлять timeout из-вне
     * @returns Promise<APIRequests[T] | Error>
     * @public
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
     * @description Ищем похожий трек, но на других платформах
     * @param track - Трек который надо найти
     * @param array - Список платформ для поиска
     * @returns Promise<Track | Error>
     * @private
     */
    private fetch = async (track: Track, array: RestServerSide.API[]): Promise<Track[] | Error> => {
        const { name, artist, api } = track;
        const original_name = `${artist.title} ${name}`;
        const original = normalize(original_name);

        // Формируем массив обещаний для каждой платформы (кроме исходной)
        const platformPromises = array
            .filter(platform => platform.name !== api.name)
            .map(async (platform) => {
                const platformAPI = this.request(platform.name);

                // Параллельный поиск по названию
                const search = await platformAPI.request<"search">(original).request();

                // Если при получении треков произошла ошибка
                if (search instanceof Error) {
                    Logger.log("ERROR", search);
                    return search;
                }

                // Если треков не найдено
                else if (!search.length) {
                    const err = Error(`[APIs/${platform.name}/fetch] Couldn't find any tracks similar to this one`);
                    Logger.log("ERROR", err);
                    return err;
                }

                // Фильтрация треков по длительности и совпадению слов
                const findTrack = search.find((song) => {
                    const candidate = normalize(`${song.artist.title} ${song.name}`);
                    const timeDiff = Math.abs(track.time.total - song.time.total);
                    const candidateArr = candidate.split(/\s+/).filter(Boolean);
                    const matchCount = candidateArr.filter(word => original.includes(word)).length;
                    const namer = getSmartMatch(original, candidate);


                    return (timeDiff <= 5) && namer || namer || (timeDiff <= 5) && (matchCount >= Math.floor(candidateArr.length * 0.75));
                });

                // Если отфильтровать треки не удалось
                if (!findTrack) {
                    const err = Error(`[APIs/${platform.name}] The tracks found do not match the description of this`);
                    Logger.log("ERROR", err);
                    return err;
                }

                // Получение деталей трека (ссылки)
                const song = await platformAPI.request<"track">(findTrack["url"]).request();

                // Если при получении трека произошла ошибка
                if (song instanceof Error) {
                    Logger.log("ERROR", song);
                    return song;
                }

                // Если нет ссылки на исходный файл
                else if (!song.link) {
                    return Error(`[APIs/${platform.name}] No audio link available`);
                }

                // Возвращаем успешный результат
                track["_duration"] = song.time;
                return song;
            });

        try {
            // Ждём первый успешный результат (или ошибку, если все упали)
            const promises = (await Promise.all(platformPromises)).filter((req) => !(req instanceof Error)) as Track[];

            // Если нет ответов
            if (promises.length === 0) return Error(`[APIs/fetch] Fail to get audio link on alternative platforms!`);
            return promises;
        } catch {
            return Error(`[APIs/fetch] Fail to get audio link on alternative platforms!`);
        }
    };

    /**
     * @description Если надо обновить ссылку на трек или аудио недоступно у платформы, получаем с другой
     * @param track - Трек у которого надо получить ссылку на исходный файл
     * @param hasReply - Если не удается получить аудио от платформы которая в теории может дать аудио
     * @returns Promise<string | Error>
     * @public
     */
    public fetchAudioLink = async (track: Track, hasReply = true): Promise<Track[] | Error> => {
        const { url, api } = track;
        const { authorization, audio, block } = this.platforms;

        try {
            // Если платформа поддерживает получение аудио и может получать данные
            if (authorization.includes(api.name) && audio.includes(api.name) && !block.includes(api.name) && hasReply) {
                const song = await this.request(api.name).request<"track">(url, { audio: true }).request();

                // Если удалось получить аудио
                if (!(song instanceof Error)) {
                    track.link = song.link;
                    return [song];
                }

                // Пробуем найти что-то похожее, но на другой платформе
            }

            // Ищем похожий трек на другой платформе
            const song = await this.fetch(track, this.array_audio);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return song;
        } catch (err) {
            Logger.log("ERROR", err as Error);
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

            const song = await this.fetch(track, this.array_related);

            // Если получена ошибка
            if (song instanceof Error) return song;

            return this.fetchRelatedTracks(song[0]);
        } catch (err) {
            Logger.log("ERROR", `[APIs/fetch] ${err}`);
            return err instanceof Error ? err : Error(`[APIs/fetch] Unexpected error ${err}`);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Разделение слов в названии трека
 * @param text - Название
 * @const normalize
 * @private
 */
const normalize = (text: string) => text
    // Удаление лишнего текста
    .replaceAll(/█/gi, "")

    .toLowerCase()
    .normalize("NFKD")

    // Оставляем только буквы и цифры, заменяя остальное на пробелы
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .trim();

/**
 * @author SNIPPIK
 * @description Ищет треки из кучи мусорного текста
 * @param original - Оригинальное название
 * @param candidate - Название кандидата
 * @private
 */
/**
 * @author SNIPPIK
 * @description Ультимативный поиск с весовыми коэффициентами и нечетким сравнением
 */
const getSmartMatch = (original: string, candidate: string) => {
    const normOriginal = normalize(original);
    const normCandidate = normalize(candidate);

    const queryWords = normOriginal.split(/\s+/).filter(word => word.length > 1);
    if (queryWords.length === 0) return false;

    // Убираем пробелы полностью для поиска "слипшихся" слов
    const compressedCandidate = normCandidate.replace(/\s+/g, "");

    let totalScore = 0;

    for (const word of queryWords) {
        // Точное вхождение слова (самый высокий приоритет)
        if (normCandidate.includes(word)) {
            totalScore += 1;
            continue;
        }

        // Вхождение без учета пробелов (для японского и слитых тегов)
        if (compressedCandidate.includes(word)) {
            totalScore += 0.8;
            continue;
        }

        // Нечеткое сравнение (Levenshtein Lite)
        // Если слово длинное (4+ символа) и отличается всего на 1-2 буквы
        if (word.length > 3) {
            if (fuzzyCheck(word, normCandidate)) {
                totalScore += 0.5;
            }
        }
    }

    const finalScore = totalScore / queryWords.length;

    // Порог вхождения: 0.8 обычно идеально для музыки
    return finalScore >= 0.8;
};

/**
 * Упрощенный нечеткий поиск: ищет, есть ли в строке слово,
 * похожее на искомое с дистанцией в 1 символ.
 */
const fuzzyCheck = (word: string, target: string): boolean => {
    if (target.length < word.length) return false;

    // Для скорости можно использовать упрощенную проверку:
    // Разбить таргет на слова и сравнить каждое по Левенштейну
    const targetWords = target.split(/\s+/);
    return targetWords.some(tWord => {
        if (Math.abs(tWord.length - word.length) > 1) return false;
        let mistakes = 0;
        for (let i = 0; i < Math.min(word.length, tWord.length); i++) {
            if (word[i] !== tWord[i]) mistakes++;
            if (mistakes > 1) return false;
        }
        return true;
    });
};