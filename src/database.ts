import { DiscordGatewayAdapterCreator } from "@structures";
import { CacheUtility } from "@service/player/utils/cache";
import { isMainThread } from "node:worker_threads";
import { RestObject } from "@handler/rest/apis";
import {VoiceConnection} from "@service/voice";
import { Commands } from "@handler/commands";
import { Buttons } from "@handler/modals";
import { Events } from "@handler/events";
import { Queues } from "@service/player";
import { Collection } from "@utils";
import { env } from "@app/env";

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
export class Database {
    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения запросов на платформы
     * @readonly
     * @public
     */
    public readonly api = isMainThread ? new RestObject() : null;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения событий
     * @readonly
     * @public
     */
    public readonly events = isMainThread ? new Events() : null;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
     * @readonly
     * @public
     */
    public readonly queues = isMainThread ? new Queues() : null;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения голосовых подключений
     * @readonly
     * @public
     */
    public readonly voice = isMainThread ? new class db_voice_system extends Collection<VoiceConnection> {
        /**
         * @description Подключение к голосовому каналу
         * @param config - Данные для подключения
         * @param adapterCreator - Функции для получения данных из VOICE_STATE_SERVER, VOICE_STATE_UPDATE
         * @public
         */
        public join = (config: VoiceConnection["configuration"], adapterCreator: DiscordGatewayAdapterCreator) => {
            let connection = this.get(config.guild_id);

            // Если нет голосового подключения
            if (!connection) {
                // Если нет голосового подключения, то создаем
                connection = new VoiceConnection(config, adapterCreator);
                this.set(config.guild_id, connection);
            }

            // Отдаем голосовое подключение
            return connection;
        };
    } : null;

    /**
     * @author SNIPPIK
     * @description Класс для кеширования аудио и данных о треках
     * @readonly
     * @public
     */
    public readonly cache = new CacheUtility();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения кнопок бота
     * @description Класс хранящий в себе все кнопки для бота
     * @readonly
     * @public
     */
    public readonly buttons = isMainThread ? new Buttons() : null;

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения команд
     * @readonly
     * @public
     */
    public readonly commands = isMainThread ? new Commands() : null;

    /**
     * @description Для управления белым списком пользователей
     * @readonly
     * @public
     */
    public readonly whitelist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("whitelist", false),
        ids: env.get("whitelist.list", "").split(",")
    };

    /**
     * @description Для управления черным списком пользователей
     * @readonly
     * @public
     */
    public readonly blacklist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("blacklist", false),
        ids: env.get("blacklist.list", "").split(",")
    };

    /**
     * @description Для работы с командами для разработчика
     * @readonly
     * @public
     */
    public readonly owner: {ids: string[]; guildID: string} = {
        guildID: env.get("owner.server", ""),
        ids: env.get("owner.list", "").split(",")
    };

    /**
     * @description Для отображения в embed сообщениях
     * @readonly
     * @public
     */
    public readonly images: {disk: string; no_image: string; loading: string} = {
        disk: env.get("image.currentPlay"),
        no_image: env.get("image.not"),
        loading: env.get("loading.emoji")
    };
}

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @class Database
 * @public
 */
export var db: Database;

/**
 * @author SNIPPIK
 * @description Инициализирует базу данных
 * @private
 */
export function initDatabase() {
    if (db) return;

    try {
        db = new Database();
    } catch (err) {
        throw new Error(`Fail init database: ${err}`);
    }
}

initDatabase();