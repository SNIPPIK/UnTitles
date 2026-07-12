import { DiscordClient, SeyfertVoice } from "#structures/discord/index.js";
import { ControllerQueues, type Queue } from "#core/queue/index.js";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

// Database modules
import { RestObject } from "#handler/rest/index.js";
import { Voices } from "#core/voice/index.js";
import { Commands } from "#handler/commands/index.js";

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
class Database {
    /** Загружаем класс для хранения запросов на платформы */
    public readonly api: RestObject;

    /** Адаптер для общения с websocket'ом клиента */
    public readonly adapter: SeyfertVoice;

    /** Загружаем класс для хранения команд */
    public readonly commands: Commands;

    /** Загружаем класс для хранения очередей, плееров, циклов */
    public readonly queues: ControllerQueues<Queue>;

    /** Загружаем класс для хранения голосовых подключений */
    public readonly voice: Voices;

    /** Для работы с командами для разработчика */
    public readonly owner: { ids: string[]; guildID: string; };

    /** Для отображения в embed сообщениях */
    public readonly images: { disk: string; no_image: string; banner: string; };

    /** Для отображения кастомных иконок */
    public readonly emoji: { disk: string; loading: string; buffer: string; user: string; lost: string; queue: string; current: string; select: string; };

    /**
     * @description Создаем класс с ограничениями не для главного потока
     * @public
     */
    public constructor(client?: DiscordClient) {
        // Если запуск произведен в другим потоке
        if (!isMainThread) return;

        // Если реально клиент
        if (client instanceof DiscordClient) {
            this.api = new RestObject();
            this.queues = new ControllerQueues();
            this.commands = new Commands();
            this.voice = new Voices();

            // Voice Adapter
            this.adapter = new SeyfertVoice(client);
        }

        this.owner = {
            guildID: env.get("owner.server", ""),
            ids: env.get("owner.list", "").split(",")
        };

        this.emoji = {
            loading: env.get("loading.emoji", "🔗"),
            disk: env.get("disk.emoji", "💿"),
            buffer: env.get("buffer.emoji", "📦"),
            user: env.get("user.emoji", "👤"),
            lost: env.get("lost.emoji", "📥"),
            queue: env.get("queue.emoji", "🎶"),
            current: env.get("current.emoji", "▶️"),
            select: env.get("selected.emoji", "➡ 🎵️")
        };

        this.images = {
            banner: env.get("image.banner"),
            disk: env.get("image.currentPlay"),
            no_image: env.get("image.not")
        };
    };
}

/**
 * @description Глобальный экземпляр разделяемой базы данных (синглтон)
 */
export let db: Database | null = null;

/**
 * @author SNIPPIK
 * @description Инициализирует базу данных
 * @function initDatabase
 * @returns void
 * @public
 */
export function initDatabase(client: DiscordClient) {
    if (db) return;

    try {
        db = new Database(client);
    } catch (err) {
        throw Error(`Fail init database: ${err}`);
    }
}