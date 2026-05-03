import { DiscordClient, DJSVoice } from "#structures/discord/index.js";
import { ControllerQueues, type Queue } from "#core/queue/index.js";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

// Database modules
import { Middlewares } from "#handler/middlewares/index.js";
import { Components } from "#handler/components/index.js";
import { Commands } from "#handler/commands/index.js";
import { RestObject } from "#handler/rest/index.js";
import { Events } from "#handler/events/index.js";
import { Voices } from "#core/voice/index.js";

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
    public readonly adapter: DJSVoice;

    /** Загружаем класс для хранения событий */
    public readonly events: Events;

    /** Загружаем класс для хранения команд */
    public readonly commands: Commands;

    /** Загружаем класс для хранения кнопок бота */
    public readonly components: Components;

    /** Загружаем класс для хранения ограничений и доп проверок бота и пользователей */
    public readonly middlewares: Middlewares;

    /** Загружаем класс для хранения очередей, плееров, циклов */
    public readonly queues: ControllerQueues<Queue>;

    /** Загружаем класс для хранения голосовых подключений */
    public readonly voice: Voices;

    /** Для работы с командами для разработчика */
    public readonly owner: { ids: string[]; guildID: string };

    /** Для отображения в embed сообщениях */
    public readonly images: { disk: string; no_image: string; banner: string; };

    /** Для отображения кастомных иконок */
    public readonly emoji: { disk: string; loading: string; buffer: string; user: string; lost: string; queue: string; current: string; select: string };

    /**
     * @description Создаем класс с ограничениями не для главного потока
     * @public
     */
    public constructor(client?: DiscordClient) {
        // Если запуск произведен в другим потоке
        if (!isMainThread) return;

        this.api = new RestObject();
        this.queues = new ControllerQueues();
        this.voice = new Voices();
        this.commands = new Commands();
        this.components = new Components();
        this.events = new Events();
        this.middlewares = new Middlewares();

        // Если реально клиент
        if (client instanceof DiscordClient) {
            this.adapter = new DJSVoice(client);
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
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @class Database
 * @public
 */
export let db: Database;

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
        throw new Error(`Fail init database: ${err}`);
    }
}