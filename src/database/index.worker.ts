import { AudioSaver, MetaSaver } from "./index.saver.js";
import { isMainThread } from "node:worker_threads";
import { SocksProxyAgent } from "socks-proxy-agent";
import { HttpProxyAgent } from "http-proxy-agent";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Локальная база данных для использования в других потоках (синглтон)
 * @class SharedDatabase
 * @public
 */
class SharedDatabase {
    /** Класс для кеширования данных о треках (доступен только в воркерах при включённом кеше) */
    public readonly meta_saver?: MetaSaver<any> = null;

    /** Класс для кеширования аудио (доступен в главном потоке при включённом кеше) */
    public readonly audio_saver?: AudioSaver = null;

    /** Прокси агент, доступен как для RestAPI так и для многих других систем */
    public readonly proxy: SocksProxyAgent | HttpProxyAgent<string>;

    /**
     * @description Создаёт экземпляр разделяемого кеша. Поля инициализируются только если кеш включён.
     * @throws {Error} если попытка создать meta_saver в главном потоке (не разрешено)
     */
    public constructor() {
        const isCaching = this.isCacheEnabled();
        this.proxy = this.createProxyAgent();

        // Если кеш отключён – поля остаются пустыми
        if (!isCaching) return;

        // audio_saver доступен только в главном потоке
        this.audio_saver = new AudioSaver();

        // meta_saver должен быть доступен только в воркер-потоках
        if (!isMainThread) {
            this.meta_saver = new MetaSaver();
        }
    };

    /**
     * @description Создание прокси агента для запросов
     * @private
     */
    private createProxyAgent = () => {
        const url = env.get("APIs.proxy", "");

        if (typeof url !== "string" || url.length === 0) return null;
        if (url.startsWith("socks")) return new SocksProxyAgent(url, { keepAlive: true, keepAliveMsecs: 20e3 });
        if (url.startsWith("http")) return new HttpProxyAgent(url, { keepAlive: true, keepAliveMsecs: 20e3 });

        return null;
    }

    /**
     * @description Проверяет, включено ли кеширование в конфигурации
     * @returns true, если кеш включён (строгое булево значение)
     * @private
     */
    private isCacheEnabled = (): boolean => {
        const value = env.get("cache");
        if (typeof value === "boolean") return value;
        if (typeof value === "string") return value.toLowerCase() === "true";
        return false; // по умолчанию кеш выключен
    };
}

/**
 * @description Глобальный экземпляр разделяемой базы данных (синглтон)
 */
export let sdb: SharedDatabase | null = null;

/**
 * @description Инициализирует глобальную разделяемую базу данных (кеш между потоками)
 * @throws {Error} если инициализация уже была произведена или произошла ошибка
 * @public
 */
export function initSharedDatabase(): void {
    if (sdb) throw Error("SharedDatabase already initialized");

    try {
        sdb = new SharedDatabase();
    } catch (err) {
        throw Error(`Failed to initialize shared database: ${err instanceof Error ? err.message : String(err)}`);
    }
}