import {dbl_commands} from "@lib/db/modules/Commands";
import {CacheUtility} from "@lib/db/utils/CacheUtility";
import {dbl_buttons} from "@lib/db/modules/Buttons";
import {dbl_audio} from "@lib/db/modules/Audio";
import {dbl_voice} from "@lib/db/modules/Voice";
import {dbl_apis} from "@lib/db/modules/APIs";
import {API, Handler} from "@handler";
import {Client} from "@lib/discord";
import {Logger} from "@lib/logger";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description База с загрузчиками
 * @private
 */
const loaders: {name: string, callback: (client: Client, item: any) => void}[] = [
    /**
     * @description Загрузчик handlers/APIs, загружает классы для запросов на платформы
     */
    {
        name: "handlers/APIs",
        callback: (client, item: API.request) => {
            if (!item.auth) db.api.platforms.authorization.push(item.name);
            if (!item.audio) db.api.platforms.audio.push(item.name);

            db.api.platforms.supported.push(item);

            // Сообщаем что было загружено
            if (client.ID === 0) Logger.log("DEBUG", `[APIs] loaded ${item.name}`);
        }
    },
    /**
     * @description Загрузчик handlers/Commands, загружает slash commands для взаимодействия с ботом
     */
    {
        name: "handlers/Commands",
        callback: (client, item: Handler.Command) => {
            if (item.data.options) {
                for (const option of item.data.options) {
                    if ("options" in option) db.commands.subCommands += option.options.length;
                }
                db.commands.subCommands += item.data.options.length;
            }
            db.commands.push(item);

            // Сообщаем что было загружено
            if (client.ID === 0) Logger.log("DEBUG", `[Commands] loaded ${item.data.name}`);
        }
    },
    /**
     * @description Загрузчик handlers/Events, загружает ивенты для управления событиями бота
     */
    {
        name: "handlers/Events",
        callback: (client, item: Handler.Event<any>) => {
            if (item.type === "client") client.on(item.name as any, (...args) => item.execute(client, ...args));
            else db.audio.queue.events.on(item.name as any, (...args: any) => item.execute(...args));

            // Сообщаем что было загружено
            if (client.ID === 0) Logger.log("DEBUG", `[Events] loaded ${item.name}`);
        }
    }
];

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
class Database {
    /**
     * @description Загружаем класс для хранения команд
     * @private
     */
    private readonly _commands = new dbl_commands();

    /**
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @private
     */
    private readonly _audio = new dbl_audio();

    /**
     * @description Загружаем класс для хранения запросов на платформы
     * @private
     */
    private readonly _apis = new dbl_apis();

    /**
     * @description Загружаем класс для хранения голосовых подключений
     * @private
     */
    private readonly _voice = new dbl_voice();

    /**
     * @description Загружаем класс для хранения кнопок бота
     * @private
     */
    private readonly _buttons = new dbl_buttons();

    /**
     * @description Класс кеширования
     * @private
     */
    private readonly _cache = new CacheUtility();

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public readonly emojis = {
        /**
         * @description Кнопки плеера
         * @readonly
         * @public
         */
        button: {
            resume:     env.get("button.resume"),
            pause:      env.get("button.pause"),
            loop:       env.get("button.loop"),
            loop_one:   env.get("button.loop_one"),
            pref:       env.get("button.pref"),
            next:       env.get("button.next"),
            shuffle:    env.get("button.shuffle"),
            replay:     env.get("button.replay"),
            queue:      env.get("button.queue"),
            lyrics:     env.get("button.lyrics"),
            filters:    env.get("button.filters"),
            stop:       env.get("button.stop")
        },

        /**
         * @description Эмодзи для 'прогресс' бара, для красоты
         * @readonly
         * @public
         */
        progress: {
            /**
             * @description Пустой прогресс бар
             */
            empty: {
                left: env.get("progress.empty.left"),
                center: env.get("progress.empty.center"),
                right: env.get("progress.empty.right")
            },

            /**
             * @description Не пустой прогресс бар
             */
            upped: {
                left: env.get("progress.not_empty.left"),
                center: env.get("progress.not_empty.center"),
                right: env.get("progress.not_empty.right")
            },

            /**
             * @description Разделение прогресс бара, поддерживает платформы
             */
            bottom: env.get("progress.bottom"),

            /**
             * @description Разделение прогресс бара, поддерживает платформы
             */
            bottom_vk: env.get("progress.bottom.vk"),

            /**
             * @description Разделение прогресс бара, поддерживает платформы
             */
            bottom_yandex: env.get("progress.bottom.yandex"),

            /**
             * @description Разделение прогресс бара, поддерживает платформы
             */
            bottom_youtube: env.get("progress.bottom.youtube"),

            /**
             * @description Разделение прогресс бара, поддерживает платформы
             */
            bottom_spotify: env.get("progress.bottom.spotify"),
        },

        /**
         * @description Прочие картинки
         * @readonly
         * @public
         */
        noImage: env.get("image.not"),
        diskImage: env.get("image.currentPlay")
    };

    /**
     * @description Для управления белым списком пользователей
     * @public
     */
    public readonly whitelist = {
        toggle: env.get("whitelist")              as boolean,
        ids: env.check("whitelist.list") ? env.get("whitelist.list").split(",") as string[] : []
    };

    /**
     * @description База для управления музыкой
     * @public
     */
    public get audio() { return this._audio };

    /**
     * @description База для управления голосовыми подключениями
     * @public
     */
    public get voice() { return this._voice };

    /**
     * @description База для управления APIs
     * @public
     */
    public get api() { return this._apis };

    /**
     * @description База для управления кнопками в текущем виде хранит в себе кнопки
     * @public
     */
    public get buttons() { return this._buttons; };

    /**
     * @description Выдаем класс с командами
     * @public
     */
    public get commands() { return this._commands; };

    /**
     * @description Выдаем класс ждя управления кешированием
     * @public
     */
    public get cache() { return this._cache; };

    /**
     * @descriptionЗапускаем и загружаем базу данных
     * @param client {Client} Класс клиента
     * @public
     */
    public set initialize(client: Client) {
        (async () => {
            Logger.log("LOG", `[Shard ${client.ID}] has initialize database`);

            // Постепенно загружаем директории с данными
            for (const handler of loaders) {
                try {
                    Logger.log("LOG", `[Shard ${client.ID}] has initialize ${handler.name}`);

                    for (const file of new Handler(handler.name).files)
                        handler.callback(client, file);
                } catch (err) {
                    throw err;
                }
            }

            // Отправляем данные о командах на сервера discord
            await this.commands.register(client);
        })();
    };
}

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @public
 */
export const db = new Database();