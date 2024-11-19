import {Database_Commands} from "@lib/db/modules/Commands";
import {Database_Buttons} from "@lib/db/modules/Buttons";
import {ExtraFilters} from "@lib/db/utils/AudioFilters";
import {Database_Audio} from "@lib/db/modules/Audio";
import {Database_Voice} from "@lib/db/modules/Voice";
import {Database_APIs} from "@lib/db/modules/APIs";
import {API, Handler} from "@handler";
import {Client} from "@lib/discord";
import {Logger} from "@lib/logger";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class Database
 * @description Локальная база данных бота
 * @public
 */
class Database {
    /**
     * @description Загружаем класс для взаимодействия с фильтрами
     * @private
     */
    private readonly _filters = new ExtraFilters();

    /**
     * @description Загружаем класс для хранения команд
     * @private
     */
    private readonly _commands = new Database_Commands();

    /**
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @private
     */
    private readonly _audio = new Database_Audio();

    /**
     * @description Загружаем класс для хранения запросов на платформы
     * @private
     */
    private readonly _apis = new Database_APIs();

    /**
     * @description Загружаем класс для хранения голосовых подключений
     * @private
     */
    private readonly _voice = new Database_Voice();

    /**
     * @description Загружаем класс для хранения кнопок бота
     * @private
     */
    private readonly _buttons = new Database_Buttons();

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
     * @description Выдаем класс для работы с базой фильтров
     * @public
     */
    public get filters() { return this._filters; };

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
 * @description База с загрузчиками
 * @private
 */
const loaders: {name: string, callback: (client: Client, item: any) => void}[] = [
    /**
     * @description Загрузчик handlers/APIs, загружает классы для запросов на платформы
     */
    {
        name: "handlers/APIs",
        callback: (_, item: API.request) => {
            if (!item.auth) db.api.platforms.authorization.push(item.name);
            if (!item.audio) db.api.platforms.audio.push(item.name);

            db.api.platforms.supported.push(item);
        }
    },
    /**
     * @description Загрузчик handlers/Commands, загружает slash commands для взаимодействия с ботом
     */
    {
        name: "handlers/Commands",
        callback: (_, item: Handler.Command) => {
            if (item.data.options) {
                for (const option of item.data.options) {
                    if ("options" in option) db.commands.subCommands += option.options.length;
                }
                db.commands.subCommands += item.data.options.length;
            }
            db.commands.push(item);
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
        }
    }
];

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @public
 */
export const db = new Database();