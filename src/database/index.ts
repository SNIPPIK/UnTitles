import { DiscordClient, DJSVoice } from "#structures/discord";
import { ControllerQueues, type Queue } from "#core/queue";
import { isMainThread } from "node:worker_threads";
import { env } from "#app/env";

// Database modules
import { Middlewares } from "#handler/middlewares";
import { Components } from "#handler/components";
import { Commands } from "#handler/commands";
import { RestObject } from "#handler/rest";
import { Events } from "#handler/events";
import { Voices } from "#core/voice";

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
class Database {
    /**
     * @description Загружаем класс для хранения запросов на платформы
     * @readonly
     * @public
     */
    public readonly api: RestObject;

    /**
     * @description Адаптер для общения с websocket'ом клиента
     * @readonly
     * @public
     */
    public readonly adapter: DJSVoice;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения событий
     * @readonly
     * @public
     */
    public readonly events: Events;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения команд
     * @readonly
     * @public
     */
    public readonly commands: Commands;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения кнопок бота
     * @description Класс хранящий в себе все кнопки для бота
     * @readonly
     * @public
     */
    public readonly components: Components;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения кнопок бота
     * @description Класс хранящий в себе все кнопки для бота
     * @readonly
     * @public
     */
    public readonly middlewares: Middlewares;

    /**
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
     * @readonly
     * @public
     */
    public readonly queues: ControllerQueues<Queue>;

    /**
     * @description Загружаем класс для хранения голосовых подключений
     * @readonly
     * @public
     */
    public readonly voice: Voices;

    /**
     * @description Для управления белым списком пользователей
     * @readonly
     * @public
     */
    public readonly whitelist: { toggle: boolean; ids: string[] };

    /**
     * @description Для управления черным списком пользователей
     * @readonly
     * @public
     */
    public readonly blacklist: { toggle: boolean; ids: string[] };

    /**
     * @description Для работы с командами для разработчика
     * @readonly
     * @public
     */
    public readonly owner: { ids: string[]; guildID: string };

    /**
     * @description Для отображения в embed сообщениях
     * @readonly
     * @public
     */
    public readonly images: { disk: string; no_image: string; loading: string; banner: string; disk_emoji: string };

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

        this.whitelist = {
            toggle: env.get<boolean>("whitelist", false),
            ids: env.get("whitelist.list", "").split(",")
        };

        this.blacklist = {
            toggle: env.get<boolean>("blacklist", false),
            ids: env.get("blacklist.list", "").split(",")
        };

        this.owner = {
            guildID: env.get("owner.server", ""),
            ids: env.get("owner.list", "").split(",")
        };

        this.images = {
            banner: env.get("image.banner"),
            disk: env.get("image.currentPlay"),
            no_image: env.get("image.not"),
            loading: env.get("loading.emoji"),
            disk_emoji: env.get("disk.emoji")
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