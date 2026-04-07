import { AudioSaver, MetaSaver } from "./index.saver";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Локальная база данных для использования в других потоках (синглтон)
 * @class SharedDatabase
 * @public
 */
class SharedDatabase {
    /**
     * @description Класс для кеширования данных о треках (доступен только в воркерах при включённом кеше)
     */
    public readonly meta_saver?: MetaSaver<any>;

    /**
     * @description Класс для кеширования аудио (доступен в главном потоке при включённом кеше)
     */
    public readonly audio_saver?: AudioSaver;

    /**
     * @description Создаёт экземпляр разделяемого кеша. Поля инициализируются только если кеш включён.
     * @throws {Error} если попытка создать meta_saver в главном потоке (не разрешено)
     */
    public constructor() {
        const isCaching = this.isCacheEnabled();

        if (!isCaching) {
            // Кеш отключён – поля остаются undefined
            return;
        }

        // audio_saver доступен только в главном потоке (или везде? судя по комментариям – только в main)
        this.audio_saver = new AudioSaver();

        // meta_saver доступен только в воркер-потоках (не в main)
        if (!isMainThread) {
            this.meta_saver = new MetaSaver();
        }
    }

    /**
     * @description Проверяет, включено ли кеширование в конфигурации
     * @returns true, если кеш включён (строгое булево значение)
     * @private
     */
    private isCacheEnabled(): boolean {
        const value = env.get("cache");
        if (typeof value === "boolean") return value;
        if (typeof value === "string") return value.toLowerCase() === "true";
        return false; // по умолчанию кеш выключен
    }
}

/**
 * @description Глобальный экземпляр разделяемой базы данных (синглтон)
 */
let _sdb: SharedDatabase | null = null;

/**
 * @description Экспортируемый объект разделяемой БД. Доступен только после инициализации.
 * @throws {Error} при обращении до вызова initSharedDatabase()
 */
export const sdb = new Proxy({} as SharedDatabase, {
    get(_, prop: keyof SharedDatabase) {
        if (!_sdb) {
            throw new Error("SharedDatabase not initialized. Call initSharedDatabase() first.");
        }
        const value = _sdb[prop];
        if (typeof value === "function") {
            return (value as Function).bind(_sdb);
        }
        return value;
    }
});

/**
 * @description Инициализирует глобальную разделяемую базу данных (кеш между потоками)
 * @throws {Error} если инициализация уже была произведена или произошла ошибка
 * @public
 */
export function initSharedDatabase(): void {
    if (_sdb) {
        throw new Error("SharedDatabase already initialized");
    }

    try {
        _sdb = new SharedDatabase();
    } catch (err) {
        throw new Error(`Failed to initialize shared database: ${err instanceof Error ? err.message : String(err)}`);
    }
}