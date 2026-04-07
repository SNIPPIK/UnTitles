import { DiscordClient, SeyfertVoice } from "#structures/discord";
import { ControllerQueues, type Queue } from "#core/queue";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

// Database modules
import { RestObject } from "#handler/rest";
import { Voices } from "#core/voice";

/**
 * @author SNIPPIK
 * @description Локальная база данных бота (синглтон)
 * @class Database
 * @public
 */
class Database {
    /**
     * @description Хранилище REST-запросов к API платформ
     */
    public readonly api: RestObject;

    /**
     * @description Адаптер для WebSocket-связи с Discord (только при наличии клиента)
     */
    public readonly adapter?: SeyfertVoice<DiscordClient>;

    /**
     * @description Хранилище очередей и плееров (один на сервер)
     */
    public readonly queues: ControllerQueues<Queue>;

    /**
     * @description Управление голосовыми соединениями
     */
    public readonly voice: Voices;

    /**
     * @description Данные для команд разработчика
     */
    public readonly owner: {
        ids: readonly string[];
        guildID: string;
    };

    /**
     * @description Ссылки на изображения и эмодзи для embed-сообщений
     */
    public readonly images: {
        disk: string;
        no_image: string;
        loading: string;
        banner: string;
        disk_emoji: string;
    };

    /**
     * @description Создаёт экземпляр базы данных. В воркер-потоке выбрасывает ошибку.
     * @param client - клиент Discord (опционально, требуется для адаптера)
     * @throws {Error} если вызван вне главного потока
     */
    public constructor(client?: DiscordClient) {
        if (!isMainThread) {
            throw new Error("Database cannot be initialized in a worker thread");
        }

        this.api = new RestObject();
        this.queues = new ControllerQueues();
        this.voice = new Voices();

        if (client instanceof DiscordClient) {
            this.adapter = new SeyfertVoice(client);
        }

        // Валидация и нормализация переменных окружения
        this.owner = {
            guildID: this.getRequiredEnv("owner.server"),
            ids: this.getEnvArray("owner.list")
        };

        this.images = {
            banner: this.getRequiredEnv("image.banner"),
            disk: this.getRequiredEnv("image.currentPlay"),
            no_image: this.getRequiredEnv("image.not"),
            loading: this.getRequiredEnv("loading.emoji"),
            disk_emoji: this.getRequiredEnv("disk.emoji")
        };
    }

    /**
     * @description Получает обязательную переменную окружения или выбрасывает ошибку
     * @param key - ключ переменной
     * @returns значение переменной
     * @private
     */
    private getRequiredEnv(key: string): string {
        const value = env.get(key);
        if (!value || typeof value !== "string") {
            throw new Error(`Missing required environment variable: ${key}`);
        }
        return value;
    }

    /**
     * @description Получает переменную окружения как массив строк, разделённых запятыми
     * @param key - ключ переменной
     * @returns массив строк (может быть пустым)
     * @private
     */
    private getEnvArray(key: string): readonly string[] {
        const value = env.get(key);
        if (!value || typeof value !== "string") {
            return [];
        }
        return value.split(",").filter(item => item.trim().length > 0);
    }
}

/**
 * @description Глобальный экземпляр базы данных (синглтон)
 */
let _db: Database | null = null;

/**
 * @description Экспортируемый объект базы данных. Доступен только после вызова initDatabase().
 * @throws {Error} если обращение до инициализации
 */
export const db = new Proxy({} as Database, {
    get(_, prop: keyof Database) {
        if (!_db) {
            throw new Error("Database not initialized. Call initDatabase() first.");
        }
        const value = _db[prop];
        if (typeof value === "function") {
            // Приводим к Function, чтобы убрать ошибку типов
            return (value as Function).bind(_db);
        }
        return value;
    }
});

/**
 * @description Инициализирует глобальную базу данных.
 * @param client - клиент Discord
 * @throws {Error} если инициализация уже была произведена или произошла ошибка
 * @public
 */
export function initDatabase(client: DiscordClient): void {
    if (_db) {
        throw new Error("Database already initialized");
    }

    try {
        _db = new Database(client);
    } catch (err) {
        throw new Error(`Failed to initialize database: ${err instanceof Error ? err.message : String(err)}`);
    }
}