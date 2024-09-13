import {Database_Commands} from "./Global/Commands";
import {Database_Audio} from "./Global/Audio";
import {Database_APIs} from "./Global/APIs";
import {API, Handler} from "@handler";
import {Client} from "@lib/discord";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @class Database
 * @description База данных бота
 * @public
 */
class Database {
    private readonly loaded = {
        commands:   new Database_Commands(),
        audio:      new Database_Audio(),
        apis:       new Database_APIs()
    };

    /**
     * @description База для управления музыкой
     * @public
     */
    public get audio() { return this.loaded.audio };

    /**
     * @description База для управления APIs
     * @public
     */
    public get api() { return this.loaded.apis };

    /**
     * @description Выдаем класс с командами
     * @public
     */
    public get commands() { return this.loaded.commands; };

    /**
     * @description Выдаем все необходимые смайлики
     * @public
     */
    public readonly emojis = {
        button: {
            resume: env.get("button.resume"),
            pause: env.get("button.pause"),
            loop: env.get("button.loop"),
            loop_one: env.get("button.loop_one"),
            pref: env.get("button.pref"),
            next: env.get("button.next"),
            shuffle: env.get("button.shuffle")
        },
        progress: {
            empty: {
                left: env.get("progress.empty.left"),
                center: env.get("progress.empty.center"),
                right: env.get("progress.empty.right")
            },
            upped: {
                left: env.get("progress.not_empty.left"),
                center: env.get("progress.not_empty.center"),
                right: env.get("progress.not_empty.right")
            },
            bottom: env.get("progress.bottom"),
            bottom_vk: env.get("progress.bottom.vk"),
            bottom_yandex: env.get("progress.bottom.yandex"),
            bottom_youtube: env.get("progress.bottom.youtube"),
            bottom_spotify: env.get("progress.bottom.spotify"),
        },
        noImage: env.get("image.not"),
        diskImage: env.get("image.currentPlay")
    };

    /**
     * @description Запускаем index
     * @param client {Client} Класс клиента
     * @public
     */
    public set initialize(client: Client) {
        (async () => {
            //Постепенно загружаем директории с данными
            for (const handler of loaders) {
                try {
                    for (const file of new Handler(handler.name).files)
                        handler.callback(client, file);
                } catch (err) {
                    throw err;
                }
            }

            //Отправляем данные о командах на сервера discord
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
     * @description Загрузчик handlers/Commands, загружает slashcommand для взаимодействия с ботом
     */
    {
        name: "handlers/Commands",
        callback: (_, item: Handler.Command) => {
            if (item.data.options) {
                for (const option of item.data.options) {
                    if ("options" in option)
                        db.commands.subCommands += option.options.length;
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
            //@ts-ignore
            else db.audio.queue.events.on(item.name as any, (...args) => item.execute(...args));
        }
    }
];

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @public
 */
export const db = new Database();