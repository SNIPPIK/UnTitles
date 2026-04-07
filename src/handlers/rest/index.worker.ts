import { parentPort, workerData } from "node:worker_threads";
import type { APIRequestsLimits } from "#handler/rest";
import type { RestServerSide } from "./index.server";
import { initSharedDatabase } from "#worker/db";
import { handler } from "#handler";
import { env } from "#app/env";

// ========== КОНСТАНТЫ ==========
/**
 * Значение лимита по умолчанию (количество элементов, возвращаемых при поиске,
 * получении плейлиста, похожих треков и т.д.). Используется, если переменная окружения не задана.
 */
const DEFAULT_LIMIT = 10;

/**
 * Таймаут на выполнение одного запроса к внешнему API (20 секунд).
 * Защита от зависания: если платформа не отвечает, запрос будет прерван,
 * а в основной поток отправится ошибка.
 */
const REQUEST_TIMEOUT_MS = 20_000;

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========
/**
 * Удаляет все функции из объекта, оставляя только поля, которые можно сериализовать.
 * Необходимо для передачи данных через `parentPort.postMessage()`, так как функции не клонируются.
 *
 * @param obj - Исходный объект (например, конфиг API платформы)
 * @returns Копия объекта, содержащая только поля, не являющиеся функциями.
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
 * Разделение ответственности: реестр хранит данные, загрузчик их заполняет.
 */
class RestRegistry {
    public readonly supported: RestServerSide.APIs = {} as RestServerSide.APIs;
    public readonly authorization: string[] = [];
    public readonly audio: string[] = [];
    public readonly related: string[] = [];
    public readonly block: string[] = [];
    private _arrayCache: RestServerSide.API[] | null = null;

    /**
     * Загружает лимиты из переменных окружения.
     * Каждый тип запроса может иметь свой лимит.
     */
    public readonly limits: Record<APIRequestsLimits, number> = (() => {
        const keys: APIRequestsLimits[] = ["playlist", "album", "search", "artist", "related"];
        const obj = {} as Record<APIRequestsLimits, number>;
        for (const key of keys) {
            obj[key] = parseInt(env.get(`APIs.limit.${key}`, "10"));
        }
        return obj;
    })();

    /**
     * Возвращает отсортированный по имени массив всех зарегистрированных платформ.
     * Результат кешируется.
     */
    public get array(): RestServerSide.API[] {
        if (!this._arrayCache) {
            this._arrayCache = Object.values(this.supported).sort((a, b) => a.name.localeCompare(b.name));
        }
        return this._arrayCache;
    };

    /** Платформы, не находящиеся в блок-листе (доступны для использования). */
    public get allowed(): RestServerSide.API[] {
        return this.array.filter(api => !this.block.includes(api.name));
    };

    /** Платформы, поддерживающие запрос "related" и не заблокированные. */
    public get relatedAllowed(): RestServerSide.API[] {
        return this.array.filter(api => api.requests?.some(req => req.name === "related"));
    };

    /**
     * Регистрирует одну платформу в реестре.
     * @param file - Конфиг API, загруженный из файла.
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
 */
class RestServerLoader extends handler<RestServerSide.API> {
    private registry: RestRegistry;

    /**
     * @param registry - Реестр, в который будут добавлены загруженные платформы.
     */
    constructor(registry: RestRegistry) {
        super("src/handlers/rest");
        this.registry = registry;
        this.loadAndRegister();
    };

    /** Загружает все файлы и регистрирует каждую платформу. */
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
 */
class RestWorkerHandler {
    /**
     * @param registry - Реестр платформ, используемый для поиска API и лимитов.
     */
    constructor(private registry: RestRegistry) {}

    /**
     * Формирует объект с данными о платформах, готовый для передачи в основной поток.
     * Удаляет все функции (они не клонируются) и преобразует в простые объекты.
     *
     * @returns Сериализуемый объект, содержащий:
     *   - supported: массив объектов платформ без функций
     *   - authorization: имена платформ с авторизацией
     *   - audio: имена платформ с поддержкой аудио
     *   - related: имена платформ с поддержкой related
     *   - block: пустой массив (заполняется в основном потоке)
     */
    public getSerializablePlatforms(): RestServerSide.Data {
        const fakeReq = this.registry.allowed.map(api => ({
            ...stripFunctions(api),
            requests: (api.requests ?? []).map(stripFunctions)
        }));
        return {
            supported: fakeReq as any,
            authorization: fakeReq.filter(api => api.auth !== null).map(api => api.name),
            audio: fakeReq.filter(api => api.audio).map(api => api.name),
            related: this.registry.relatedAllowed.map(api => api.name),
            block: []
        };
    };

    /**
     * Выполняет запрос к платформе с ограничением по времени.
     *
     * @param options - Параметры запроса:
     *   - platform: имя платформы
     *   - payload: строка (URL, поисковый запрос)
     *   - options: { audio?: boolean }
     *   - requestId: уникальный идентификатор для сопоставления ответа
     *   - type: тип запроса (search, track, related...)
     * @returns Ничего не возвращает, результат отправляется через parentPort.
     */
    public async executeRequest(options: RestServerSide.ServerOptions & { requestId: number }): Promise<void> {
        const { platform, payload, options: reqOpts, requestId, type } = options;

        try {
            const restPlatform = this.registry.supported[platform];
            if (!restPlatform) {
                this.sendError(requestId, new Error(`Platform not found: ${platform}`));
                return;
            }

            const callback = restPlatform.requests?.find(req => req.name === "all" || req.name === type);
            if (!callback) {
                this.sendError(requestId, new Error(`Callback not found for platform: ${platform}, type: ${type}`));
                return;
            }

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
        } catch (err: any) {
            this.sendError(requestId, err);
        }
    };

    /**
     * Оборачивает промис в таймаут.
     *
     * @param promise - Исходный промис (запрос к API)
     * @param ms - Максимальное время ожидания в миллисекундах
     * @param timeoutMessage - Сообщение об ошибке при таймауте
     * @returns Промис, который всегда резолвится (не реджектится) — либо результатом, либо ошибкой.
     */
    private withTimeout<T>(promise: Promise<T>, ms: number, timeoutMessage: string): Promise<T | Error> {
        return new Promise((resolve) => {
            const timer = setTimeout(() => resolve(new Error(timeoutMessage)), ms);
            promise
                .then(res => { clearTimeout(timer); resolve(res); })
                .catch(err => { clearTimeout(timer); resolve(err); });
        });
    };

    /** Отправляет успешный результат в основной поток. */
    private sendSuccess(requestId: number, type: string, result: any): void {
        parentPort?.postMessage({ requestId, status: "success", type, result });
    };

    /** Отправляет ошибку в основной поток, преобразуя её в сериализуемый объект. */
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
 * 1. Инициализация общей базы данных.
 * 2. Создание реестра и загрузка платформ.
 * 3. Создание обработчика запросов.
 * 4. Установка обработчика сообщений от основного потока.
 * 5. Глобальный перехват unhandledRejection.
 */
if (parentPort && workerData?.rest) {
    initSharedDatabase();

    const registry = new RestRegistry();
    new RestServerLoader(registry); // синхронно загружает платформы
    const handler = new RestWorkerHandler(registry);

    parentPort.on("message", async (message: RestServerSide.ServerOptions & { requestId?: number }) => {
        try {
            // Запрос на получение списка платформ
            if (message.data) {
                const platforms = handler.getSerializablePlatforms();
                parentPort.postMessage(platforms);
                return;
            }

            // Обычный запрос к платформе
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
                result: err instanceof Error ? err : new Error(String(err))
            });
        }
    });

    // Глобальный перехват непойманных reject'ов (защита от падения воркера)
    process.on("unhandledRejection", (err) => {
        parentPort?.postMessage({
            requestId: undefined,
            status: "error",
            result: err instanceof Error ? err : new Error(String(err))
        });
    });
}