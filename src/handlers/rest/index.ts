import { APIRequestData, APIRequests, APIRequestsKeys, RestAPINames, APIPlatformType, REST_STOP_WORDS } from "#handler/rest/index.abstract.js";
import type { RestServerSide } from "./index.server.js";
import { Logger, SimpleWorker } from "#structures";
import { RestClientSide } from "./index.client.js";
import { Track } from "#core/queue/index.js";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

// Export decorator
export * from "./index.abstract.js";
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
    protected worker: SimpleWorker;

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
    /*public get methods() {
        let reqs = 0;

        // Прогоняем платформы и собираем кол-во доступных запросов
        for (let i of this.array) {
            reqs += i.requests.length;
        }

        return reqs;
    };*/

    /**
     * @description Заблокирована ли платформа?
     * @param platform
     * @public
     */
    public hasBlocked = (platform: RestAPINames) => {
        return this.platforms.block.includes(platform);
    };

    /**
     * @description Функция для инициализации worker (адаптированная под нестатический SimpleWorker)
     * @returns Promise<boolean>
     * @public
     */
    public init = (): Promise<boolean> => {
        return new Promise(async (resolve) => {
            // Если поток запущен, уничтожаем старый
            if (this.worker) {
                await this.worker.destroy();
                this.worker = null;
            }

            const __filename = fileURLToPath(import.meta.url);
            const __dirname = dirname(__filename);

            // Создаём экземпляр SimpleWorker (нестатический)
            const worker = new SimpleWorker<RestServerSide.Data | any, RestServerSide.Result<T> & { requestId?: number }>(
                __dirname + "/index.worker",
                {
                    workerData: { rest: true },
                    stderr: false
                },
                false,
                Logger
            );

            // Подписываемся на постоянные сообщения (для обработки запросов)
            worker.on("message", (message) => {
                const request = this.pending.get(message.requestId);
                this.pending.delete(message.requestId);

                // Отклоняем если данные не имеют ID
                if (!request) return;
                return request.resolve(message);
            });

            // Обработка ошибок — пересоздаём воркер
            worker.once("error", async (error) => {
                Logger.log("ERROR", error);

                // Если в этот момент появились запросы
                for (let [key, value] of this.pending) {
                    value.resolve({
                        requestId: key,
                        status: "error",
                        result: Error("Worker has dead, need a retry request!")
                    });
                }

                this.pending.clear(); // Очищаем Map

                // Уничтожаем текущий экземпляр
                await worker.destroy();

                // Перезапускаем через задержку
                setTimeout(() => this.init(), 2000);
            });

            // Запускаем воркер и отправляем начальные данные
            worker.start({data: true});

            // Ждём первое сообщение (инициализация платформ)
            // Используем once, чтобы дождаться именно первого сообщения.
            // Обрабатываем инициализацию
            this.platforms = await new Promise<RestServerSide.Data>((resolveFirst) => {
                worker.once("message", (data) => resolveFirst(data as any));
            });

            // Чистим map
            this.map.clear();
            for (const api of this.array) {
                if (api.auth !== null) {
                    this.map.set(api.name.toUpperCase(), api);
                }
            }

            // Сохраняем worker в поле класса для дальнейшего использования (отправка запросов)
            this.worker = worker;
            resolve(true);
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

        // Если поток есть в системе
        if (this.worker) {
            await this.worker.destroy();
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
        // Если не указана платформа
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
    public request_worker<T extends APIRequestsKeys>(params: RestClientSide.ClientOptions): Promise<APIRequests<T>| Error> {
        const {platform, payload, options, type} = params;
        return new Promise<APIRequests<T> | Error>((resolve) => {
            const requestId = this.generateUniqueId();

            // Регистрируем "ждущего"
            this.pending.set(requestId, {
                resolve: (message) => resolve(this.worker_resolve(message, params) as Error | APIRequests<T>)
            });

            // Отправляем запрос
            this.worker.send({ platform: platform.name, payload, options, requestId, type });
            Logger.log("DEBUG", `[Rest/API |${type}| SEND - ${platform.name}]: ${payload}`);
        });
    };

    /**
     * Обработчик ответа от воркера (REST-клиента), вызываемый при получении результата
     * выполнения запроса. Разбирает ответ в зависимости от статуса и преобразует данные
     * в удобный для вызывающего кода вид.
     *
     * @param message - Сообщение от серверной части (воркера). Содержит:
     *   - `result` — данные ответа (зависит от типа запроса).
     *   - `status` — статус выполнения: `"success"`, `"error"` или неожиданный.
     *   - `requestId?` — опциональный идентификатор запроса (не используется в текущей логике).
     * @param param1 - Параметры клиентского запроса:
     *   - `platform` — объект платформы (содержит имя, используемое для блокировки и логирования).
     *   - `payload` — строка, переданная в запросе (например, URL или поисковый запрос).
     *   - `type` — тип запроса (например, `"GET"`, `"POST"`), используется в логах.
     *
     * @returns Результат обработки:
     *   - Для `"success"`: массив `Track[]`, объект с полем `items` (плейлист) или одиночный `Track`.
     *   - Для `"error"`: объект `Error` со стеком ошибки.
     *   - При неизвестном статусе: объект `Error` с сообщением `"Unknown response!!!"`.
     *
     * @private
     * @remarks
     * Метод вызывается автоматически при получении ответа от воркера. Он:
     * 1. Логирует успешные запросы с уровнем `DEBUG`.
     * 2. Преобразует "сырые" объекты треков в экземпляры класса `Track`.
     * 3. Обрабатывает критические ошибки (таймауты, проблемы с клиентским ID) — добавляет платформу
     *    в список заблокированных (`this.platforms.block`).
     * 4. Логирует неожиданные статусы с уровнем `WARN`.
     */
    private worker_resolve = (message: RestServerSide.Result<APIRequestsKeys> & { requestId?: number }, { platform, payload, type }: RestClientSide.ClientOptions) => {
        const { result, status } = message;

        /**
         * Обработка в зависимости от статуса ответа.
         */
        switch (status) {
            // Успешный ответ
            case "success": {
                Logger.log("DEBUG", `[Rest/API |${type}| GET  - ${platform.name}]: ${payload}`);

                // Функция-обёртка для преобразования данных трека в экземпляр Track.
                const parseTrack = (item: APIRequestData.Track) => new Track(item, platform);

                // Если ответ содержит массив треков — маппим каждый элемент.
                if (Array.isArray(result)) {
                    return result.map(parseTrack);
                }
                // Если ответ является объектом с полем `items` (плейлист) — обрабатываем вложенные треки.
                else if (typeof result === "object" && "items" in result) {
                    return { ...result, items: result.items.map(parseTrack) };
                }
                // Иначе считаем, что это одиночный трек.
                return parseTrack(result);
            }

            // Ошибка при выполнении запроса
            case "error": {
                Logger.log("ERROR", result.stack);

                // Если ошибка связана с тайм-аутом соединения или невозможностью получить client ID,
                // блокируем платформу, чтобы предотвратить повторные неудачные запросы.
                if (
                    /Connection Timeout/.test(result.message) ||
                    /Fail getting client ID/.test(result.message)
                ) {
                    this.platforms.block.push(platform.name);
                }

                // Возвращаем объект Error, чтобы вызывающий код мог обработать ошибку.
                return Error(result.stack);
            }

            // Неожиданный статус
            default: {
                Logger.log("WARN", `An unknown response was received from another thread!`);
                return Error(`Unknown response!!!`);
            }
        }
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

                    return (timeDiff <= 5) && namer || (timeDiff <= 5) && (matchCount >= Math.floor(candidateArr.length * 0.75)) ||
                        namer || song.name.toLowerCase().includes(track.name.toLowerCase());
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
 * Нормализует текст для последующего сравнения или поиска.
 *
 * Процесс нормализации включает:
 * 1. Приведение строки к форме NFKD (декомпозиция диакритических знаков).
 * 2. Удаление всех диакритических знаков (категория `\p{M}`).
 * 3. Удаление символа `█` (вероятно, используемого в плейсхолдерах или оформлении).
 * 4. Перевод в нижний регистр.
 * 5. Замена всех символов, не являющихся буквами (`\p{L}`), цифрами (`\p{N}`) или пробелами (`\s`),
 *    на пробел.
 * 6. Разбиение на слова по пробелам.
 * 7. Фильтрация:
 *    - Слова длиной ≤ 1 отбрасываются (артикли, одиночные буквы).
 *    - Слова, входящие в множество стоп-слов (`REST_STOP_WORDS`), отбрасываются.
 * 8. Объединение оставшихся слов обратно в строку через пробел.
 *
 * Итоговая строка содержит только значимые слова в нижнем регистре без лишних символов.
 *
 * @param text - Исходная строка (название трека, имя исполнителя и т.п.).
 * @returns Нормализованная строка, готовая для сравнения.
 */
const normalize = (text: string) =>
    text
        // Декомпозиция: буква + диакритический знак
        .normalize("NFKD")
        // Удаляем все combining marks (диакритику)
        .replace(/\p{M}/gu, "")
        // Удаляем специфический символ
        .replace(/█/g, "")
        // Единый регистр
        .toLowerCase()
        // Все, кроме букв/цифр/пробелов, заменяем пробелом
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        // Разбиваем на слова (пробелы любой длины)
        .split(/\s+/)
        // Фильтр коротких и стоп-слов
        .filter(word => word.length > 1 && !REST_STOP_WORDS.has(word))
        // Обратно в строку
        .join(" ");

/**
 * Проверяет, существует ли в наборе слов кандидат, нечётко совпадающий с заданным словом.
 *
 * Алгоритм основан на расстоянии Левенштейна с ограничением в 1 ошибку.
 * Для каждой пары (word, candidate):
 * - Если разница длин больше 1 — кандидат пропускается.
 * - Иначе выполняется посимвольное сравнение с разрешённой одной операцией (замена/вставка/удаление).
 * - Счётчик `mistakes` увеличивается при каждом несовпадении.
 * - После цикла добавляются оставшиеся символы (если строки разной длины).
 * - Если итоговое количество ошибок ≤ 1, возвращается `true`.
 *
 * @param word  - Проверяемое слово (уже нормализованное).
 * @param words - Итерируемый набор слов-кандидатов (обычно из целевой строки).
 * @returns `true`, если найдено нечёткое совпадение с допустимым уровнем ошибок, иначе `false`.
 */
const fuzzyCheck = (word: string, words: Iterable<string>): boolean => {
    for (const candidate of words) {
        const lenDiff = Math.abs(candidate.length - word.length);
        if (lenDiff > 1) continue; // Слишком разная длина — не может быть похожими при 1 ошибке

        let mistakes = 0;
        let i = 0; // указатель для word
        let j = 0; // указатель для candidate

        while (i < word.length && j < candidate.length) {
            if (word[i] === candidate[j]) {
                i++;
                j++;
                continue;
            }

            // Несовпадение — фиксируем ошибку
            if (++mistakes > 1) break;

            // Обработка в зависимости от соотношения длин:
            // Если word длиннее — считаем, что в candidate пропущен символ (вставка в candidate)
            // Если candidate длиннее — символ пропущен в word (удаление из candidate)
            // Если равны — замена: сдвигаем оба указателя
            if (word.length > candidate.length) i++;
            else if (candidate.length > word.length) j++;
            else {
                i++;
                j++;
            }
        }

        // Добавляем оставшиеся символы как ошибки (если длины не совпали)
        mistakes += (word.length - i) + (candidate.length - j);

        if (mistakes <= 1) return true;
    }

    return false;
};

/**
 * Выполняет интеллектуальное сравнение двух строк (например, названий треков)
 * с учётом нормализации, весов слов и нечёткого сопоставления.
 *
 * Алгоритм:
 * 1. Нормализует обе строки через `normalize()`.
 * 2. Если одна из строк пуста после нормализации — возвращает `false`.
 * 3. Если строки полностью совпадают — возвращает `true`.
 * 4. Разбивает исходную строку (`source`) на слова, а целевую (`target`) преобразует в `Set`.
 * 5. Вычисляет «сжатую» версию `target` без пробелов для проверки вхождений подстрок.
 * 6. Для каждого слова из `source` вычисляет вес: `min(word.length / 6, 1)`.
 *    Вес отражает значимость слова (более длинные слова имеют больший вклад).
 * 7. Сравнивает слова:
 *    - Точное совпадение со словом из `targetWords` → полный вес.
 *    - Слово целиком входит в `compressed` → вес * 0.9 (например, склеенные слова).
 *    - Длина слова ≥ 4 и нечёткое совпадение с каким-либо словом из `targetWords` → вес * 0.7.
 *    - Иначе вклад 0.
 * 8. Если `target` содержит всю `source` как подстроку (после нормализации) — добавляет бонус 1.
 * 9. Итоговая оценка: `score / (maxScore + 1)`. Если она ≥ `threshold` (по умолчанию 0.8) — `true`.
 *
 * Такой подход устойчив к перестановке слов, опечаткам, лишним пробелам и незначительным отличиям.
 *
 * @param original  - Исходная строка (например, запрос или эталон).
 * @param candidate - Строка-кандидат для сравнения.
 * @param threshold - Порог схожести (0..1). Чем выше, тем строже сравнение.
 * @returns `true`, если строки достаточно похожи, иначе `false`.
 */
const getSmartMatch = (original: string, candidate: string, threshold = 0.8): boolean => {
    const source = normalize(original);
    const target = normalize(candidate);

    // Если после нормализации хотя бы одна строка пуста, сравнение невозможно
    if (!source || !target)
        return false;

    // Полное совпадение — мгновенный успех
    if (source === target)
        return true;

    const sourceWords = source.split(/\s+/);
    const targetWords = new Set(target.split(/\s+/));

    // Убираем все пробелы для проверки вхождений подстрок
    const compressed = target.replace(/\s+/g, "");

    let score = 0;
    let maxScore = 0;

    for (const word of sourceWords) {
        // Вес слова: чем длиннее, тем выше, но не более 1
        const weight = Math.min(word.length / 6, 1);
        maxScore += weight;

        if (targetWords.has(word)) {
            // Точное совпадение слова
            score += weight;
            continue;
        }

        if (compressed.includes(word)) {
            // Слово является подстрокой сжатой целевой строки (возможно, слова склеены)
            score += weight * 0.9;
            continue;
        }

        // Для длинных слов (>=4) пробуем нечёткое сравнение с кандидатами
        if (word.length >= 4 && fuzzyCheck(word, targetWords)) {
            score += weight * 0.7;
        }
    }

    // Бонус, если вся исходная строка является подстрокой целевой
    if (target.includes(source))
        score += 1;

    // Нормируем: делим на максимально возможный балл + 1 (чтобы избежать деления на 0)
    return score / (maxScore + 1) >= threshold;
};