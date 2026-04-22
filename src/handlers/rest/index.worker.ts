/**
 * @fileoverview Воркер для выполнения REST-запросов к музыкальным платформам (YouTube, Spotify и др.)
 *
 * Этот модуль запускается в отдельном потоке (worker_threads) и обрабатывает:
 * - Загрузку всех реализаций API платформ из директории `src/handlers/rest`.
 * - Хранение их конфигураций, лимитов и блок-листов.
 * - Выполнение запросов (поиск, получение треков, плейлистов, похожих треков) с тайм-аутами.
 * - Сериализацию данных для передачи в основной поток (удаление функций).
 *
 * Взаимодействие с основным потоком осуществляется через `parentPort`.
 *
 * @module RestWorker
 */

import { parentPort, workerData } from "node:worker_threads";
import type { APIRequestsLimits } from "#handler/rest";
import type { RestServerSide } from "./index.server";
import { initSharedDatabase } from "#worker/db";
import { handler } from "#handler";
import { env } from "#app/env";

// ========== КОНСТАНТЫ ==========

/**
 * Значение лимита по умолчанию (количество элементов, возвращаемых при поиске,
 * получении плейлиста, похожих треков и т.д.).
 * Используется, если переменная окружения не задана.
 *
 * @constant
 * @default 10
 */
const DEFAULT_LIMIT = 10;

/**
 * Тайм-аут на выполнение одного запроса к внешнему API (20 секунд).
 * Защита от зависания: если платформа не отвечает, запрос будет прерван,
 * а в основной поток отправится ошибка.
 *
 * @constant
 * @default 20000
 */
const REQUEST_TIMEOUT_MS = 20_000;

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

/**
 * Удаляет все функции из объекта, оставляя только поля, которые можно сериализовать.
 * Необходимо для передачи данных через `parentPort.postMessage()`, так как функции не клонируются.
 *
 * @typeParam T - Тип исходного объекта.
 * @param obj - Исходный объект (например, конфиг API платформы).
 * @returns Копия объекта, содержащая только поля, не являющиеся функциями.
 *
 * @remarks
 * Функция не использует кеширование, так как вызывается только один раз при старте воркера
 * для сериализации всех платформ. Если потребуется частое использование, следует добавить `WeakMap`.
 *
 * @example
 * const api = { name: "YOUTUBE", execute: async () => {}, auth: null };
 * stripFunctions(api); // { name: "YOUTUBE", auth: null }
 */
function stripFunctions<T extends object>(obj: T): RestServerSide.Serializable<T> {
    return Object.fromEntries(
        Object.entries(obj).filter(([_, v]) => typeof v !== "function")
    ) as RestServerSide.Serializable<T>;
}

// ========== КЛАСС-КОНТЕЙНЕР ДЛЯ ПЛАТФОРМ И ЛИМИТОВ ==========

/**
 * Реестр платформ — центральное хранилище информации о загруженных API,
 * их возможностях (аудио, related, авторизация), лимитов запросов и блок-листа.
 *
 * @remarks
 * - Разделение ответственности: реестр хранит данные, загрузчик (`RestServerLoader`) их заполняет.
 * - Кеширует отсортированный массив платформ для быстрого доступа.
 * - Лимиты загружаются из переменных окружения при создании экземпляра.
 */
class RestRegistry {
    /** Объект, где ключ — имя платформы (например, "YOUTUBE"), значение — конфиг API. */
    public readonly supported: RestServerSide.APIs = {} as RestServerSide.APIs;

    /** Массив имён платформ, требующих авторизацию (auth !== null). */
    public readonly authorization: string[] = [];

    /** Массив имён платформ, поддерживающих аудио-ссылку (audio === true). */
    public readonly audio: string[] = [];

    /** Массив имён платформ, поддерживающих запрос похожих треков (имеют request с name === "related"). */
    public readonly related: string[] = [];

    /** Блок-лист: имена платформ, временно недоступных (заполняется из основного потока). */
    public readonly block: string[] = [];

    /** Кеш отсортированного массива всех платформ (сбрасывается при регистрации новой платформы). */
    private _arrayCache: RestServerSide.API[] | null = null;

    /**
     * Лимиты для различных типов запросов (playlist, search, etc.).
     * Значения берутся из переменных окружения `APIs.limit.<type>`, по умолчанию 10.
     */
    public readonly limits: Record<APIRequestsLimits, number> = (() => {
        const keys: APIRequestsLimits[] = ["playlist", "album", "search", "artist", "related"];
        const obj = {} as Record<APIRequestsLimits, number>;
        for (const key of keys) {
            obj[key] = parseInt(env.get(`APIs.limit.${key}`, `${DEFAULT_LIMIT}`));
        }
        return obj;
    })();

    /**
     * Возвращает отсортированный по имени массив всех зарегистрированных платформ.
     * Результат кешируется для производительности.
     */
    public get array(): RestServerSide.API[] {
        if (!this._arrayCache) {
            this._arrayCache = Object.values(this.supported).sort((a, b) => a.name.localeCompare(b.name));
        }
        return this._arrayCache;
    };

    /**
     * Платформы, не находящиеся в блок-листе (доступны для использования).
     */
    public get allowed(): RestServerSide.API[] {
        return this.array.filter(api => !this.block.includes(api.name));
    };

    /**
     * Платформы, поддерживающие запрос "related" и не заблокированные.
     */
    public get relatedAllowed(): RestServerSide.API[] {
        return this.array.filter(api => api.requests?.some(req => req.name === "related"));
    };

    /**
     * Регистрирует одну платформу в реестре.
     *
     * @param file - Конфиг API, загруженный из файла.
     *
     * @remarks
     * Добавляет имя платформы в соответствующие списки (authorization, audio, related)
     * в зависимости от её свойств. Сбрасывает кеш массива платформ.
     */
    public registerPlatform(file: RestServerSide.API): void {
        if (file.auth !== null) this.authorization.push(file.name);
        if (file.audio) this.audio.push(file.name);
        if (file.requests?.some(req => req.name === "related")) this.related.push(file.name);
        this.supported[file.name] = file;
        this._arrayCache = null; // сброс кеша
    };
}

// ========== ЗАГРУЗЧИК ПЛАТФОРМ ==========

/**
 * Загружает реализации платформ из файловой системы с помощью базового класса `handler`.
 * После загрузки каждого файла платформа регистрируется в реестре.
 *
 * @remarks
 * Загрузка происходит синхронно при создании экземпляра.
 */
class RestServerLoader extends handler<RestServerSide.API> {
    private registry: RestRegistry;

    /**
     * @param registry - Реестр, в который будут добавлены загруженные платформы.
     */
    public constructor(registry: RestRegistry) {
        super("src/handlers/rest");
        this.registry = registry;
        this.loadAndRegister();
    };

    /**
     * Загружает все файлы из директории и регистрирует каждую платформу.
     *
     * @remarks
     * Вызывает родительский метод `load()`, который рекурсивно обходит директорию,
     * загружает файлы (кроме index) и сохраняет экземпляры в `this.files`.
     * Затем проходит по всем загруженным объектам и регистрирует их.
     */
    private loadAndRegister(): void {
        this.load(); // синхронный обход директории, заполнение this.files
        for (const file of this.files) {
            this.registry.registerPlatform(file);
        }
    };
}

// ========== ОБРАБОТЧИК ЗАПРОСОВ ВОРКЕРА ==========

/**
 * Класс, отвечающий за обработку входящих сообщений от основного потока.
 *
 * @remarks
 * Предоставляет методы для:
 * - Получения сериализованного списка платформ.
 * - Выполнения запросов к API с тайм-аутом.
 * - Отправки результатов (успех/ошибка) обратно в основной поток.
 */
class RestWorkerHandler {
    /**
     * @param registry - Реестр платформ, используемый для поиска API и лимитов.
     */
    public constructor(private registry: RestRegistry) {};

    /**
     * Формирует объект с данными о платформах, готовый для передачи в основной поток.
     * Удаляет все функции (они не клонируются) и преобразует в простые объекты.
     *
     * @returns Сериализуемый объект, содержащий:
     *   - `supported` — массив объектов платформ без функций.
     *   - `authorization` — имена платформ с авторизацией.
     *   - `audio` — имена платформ с поддержкой аудио.
     *   - `related` — имена платформ с поддержкой related.
     *   - `block` — пустой массив (заполняется в основном потоке при ошибках).
     */
    public getSerializablePlatforms(): RestServerSide.Data {
        // Берём только не заблокированные платформы
        const fakeReq = this.registry.allowed.map(api => ({
            ...stripFunctions(api),
            requests: (api.requests ?? []).map(stripFunctions)
        }));
        return {
            supported: fakeReq as any,
            authorization: fakeReq.filter(api => api.auth !== null).map(api => api.name),
            audio: fakeReq.filter(api => api.audio).map(api => api.name),
            related: this.registry.relatedAllowed.map(api => api.name),
            block: [] // блок-лист изначально пуст
        };
    };

    /**
     * Выполняет запрос к платформе с ограничением по времени.
     *
     * @param options - Параметры запроса:
     *   - `platform` — имя платформы (например, "YOUTUBE").
     *   - `payload` — строка (URL, поисковый запрос, ID).
     *   - `options` — опциональные настройки (например, `{ audio: true }`).
     *   - `requestId` — уникальный идентификатор для сопоставления ответа.
     *   - `type` — тип запроса (search, track, related...).
     * @returns Ничего не возвращает, результат отправляется через `parentPort`.
     *
     * @remarks
     * Алгоритм:
     * 1. Находит объект платформы в реестре.
     * 2. Ищет подходящий колбэк (сначала точное совпадение `type`, затем "all").
     * 3. Вызывает колбэк с payload и лимитом из реестра.
     * 4. Оборачивает вызов тайм-аутом (REQUEST_TIMEOUT_MS).
     * 5. При успехе — вызывает `sendSuccess`, при ошибке — `sendError`.
     */
    public async executeRequest(options: RestServerSide.ServerOptions & { requestId: number }): Promise<void> {
        const { platform, payload, options: reqOpts, requestId, type } = options;

        try {
            const restPlatform = this.registry.supported[platform];
            if (!restPlatform) {
                this.sendError(requestId, new Error(`Platform not found: ${platform}`));
                return;
            }

            // Ищем обработчик: сначала по точному имени типа, затем "all"
            const callback = restPlatform.requests?.find(req => req.name === type || req.name === "all");
            if (!callback) {
                this.sendError(requestId, new Error(`Callback not found for platform: ${platform}, type: ${type}`));
                return;
            }

            // Выполняем запрос с тайм-аутом
            const result = await this.withTimeout(
                callback.execute(payload, {
                    audio: reqOpts?.audio !== undefined ? reqOpts.audio : true,
                    limit: this.registry.limits[callback.name as APIRequestsLimits] ?? DEFAULT_LIMIT,
                }),
                REQUEST_TIMEOUT_MS,
                `Request timeout for ${platform}.${callback.name}`
            );

            if (result instanceof Error) {
                this.sendError(requestId, result);
                return;
            }

            this.sendSuccess(requestId, callback.name, result);
        } catch (err) {
            this.sendError(requestId, err as Error);
        }
    };

    /**
     * Оборачивает обещание в тайм-аут.
     *
     * @param promise - Исходный промис (запрос к API).
     * @param ms - Максимальное время ожидания в миллисекундах.
     * @param timeoutMessage - Сообщение об ошибке при тайм-ауте.
     * @returns Промис, который всегда резолвится (не реджектится) — либо результатом, либо ошибкой.
     *
     * @remarks
     * В текущей реализации исходный запрос не отменяется (нет AbortController), но это допустимо,
     * так как воркер всё равно игнорирует результат после тайм-аута.
     */
    private withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T | Error> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(new Error(timeoutMessage)), ms);
            promise
                .then(res => { clearTimeout(timer); resolve(res); })
                .catch(err => { clearTimeout(timer); resolve(err); });
        });
    };

    /**
     * Отправляет успешный результат в основной поток.
     *
     * @param requestId - Идентификатор запроса.
     * @param type - Тип запроса (например, "search").
     * @param result - Данные ответа (трек, массив треков и т.п.).
     */
    private sendSuccess(requestId: number, type: string, result: any): void {
        parentPort?.postMessage({ requestId, status: "success", type, result });
    };

    /**
     * Отправляет ошибку в основной поток, преобразуя её в сериализуемый объект.
     *
     * @param requestId - Идентификатор запроса.
     * @param err - Объект ошибки (Error или любой другой).
     */
    private sendError(requestId: number, err: any): void {
        const errorObj = err instanceof Error
            ? { name: err.name, message: err.message, stack: err.stack }
            : { name: "UnknownError", message: String(err), stack: undefined };
        parentPort?.postMessage({ requestId, status: "error", result: errorObj });
    };
}

// ========== ИНИЦИАЛИЗАЦИЯ ВОРКЕРА ==========

/**
 * Код выполняется только если этот файл запущен как worker (parentPort !== null)
 * и в workerData передан флаг `rest: true`.
 *
 * @remarks
 * Последовательность инициализации:
 * 1. Инициализация общей базы данных (через `initSharedDatabase`).
 * 2. Создание реестра и синхронная загрузка платформ.
 * 3. Создание обработчика запросов.
 * 4. Установка обработчика сообщений от основного потока.
 * 5. Глобальный перехват `unhandledRejection` для предотвращения падения воркера.
 *
 * @throws Ошибки, возникающие при инициализации, логируются, но не останавливают воркер.
 */
if (parentPort && workerData?.rest) {
    // Инициализируем общие ресурсы (например, кеш, логгер)
    initSharedDatabase();

    const registry = new RestRegistry();
    // Загружаем все платформы (синхронно)
    new RestServerLoader(registry);
    const handler = new RestWorkerHandler(registry);

    // Обработка сообщений от основного потока
    parentPort.on("message", async (message: RestServerSide.ServerOptions & { requestId?: number }) => {
        try {
            // Сообщение-запрос на получение списка платформ (при старте)
            if (message.data) {
                const platforms = handler.getSerializablePlatforms();
                parentPort.postMessage(platforms);
                return;
            }

            // Обычный запрос к платформе (должен содержать platform и числовой requestId)
            if (message.platform && typeof message.requestId === "number") {
                await handler.executeRequest(message as any);
                return;
            }

            // Неподдерживаемый тип сообщения
            parentPort.postMessage({
                status: "error",
                requestId: message.requestId,
                result: new Error("Unsupported request type")
            });
        } catch (err) {
            parentPort.postMessage({
                status: "error",
                requestId: message.requestId,
                result: err instanceof Error ? err : new Error(err as any)
            });
        }
    });

    // Глобальный перехват не пойманных reject'ов (защита от падения воркера)
    process.on("unhandledRejection", (err) => {
        parentPort?.postMessage({
            requestId: undefined,
            status: "error",
            result: err instanceof Error ? err : new Error(err as any)
        });
    });
}