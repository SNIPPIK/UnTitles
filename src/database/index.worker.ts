import { AudioSaver, MetaSaver } from "./index.saver";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Локальная база данных для использования в других потоках
 * @class SharedDatabase
 * @public
 */
class SharedDatabase {
    /**
     * @description Класс для кеширования данных о треках
     * @readonly
     * @public
     */
    public readonly meta_saver: MetaSaver;

    /**
     * @description Класс для кеширования аудио
     * @readonly
     * @public
     */
    public readonly audio_saver: AudioSaver;

    /**
     * @description Создаем класс для работы с кешем
     * @public
     */
    public constructor() {
        const isCaching = env.get("cache") as boolean;

        if (isCaching) {
            // Нужен для работы Rest/API (только в других потоках)
            if (!isMainThread) this.meta_saver = new MetaSaver();

            // Работает в Main
            this.audio_saver = new AudioSaver();
        }
    };
}

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @class Database
 * @public
 */
export let sdb: SharedDatabase;

/**
 * @author SNIPPIK
 * @description Инициализирует базу данных для кеширования между потоками
 * @function initSharedDatabase
 * @returns void
 * @public
 */
export function initSharedDatabase() {
    if (sdb || process.argv.includes("--ShardManager")) return;

    try {
        sdb = new SharedDatabase();
    } catch (err) {
        throw new Error(`Fail init shared database: ${err}`);
    }
}