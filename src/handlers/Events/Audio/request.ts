import {Constructor, Handler, API} from "@handler";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class request_api
 * @event request/api
 * @public
 */
class request_api extends Constructor.Assign<Handler.Event<"request/api">> {
    public constructor() {
        super({
            name: "request/api",
            type: "player",
            execute: (message, argument) => {
                const platform = new API.response(argument[0] as string);

                // Если платформа заблокирована
                if (platform.block) {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.block"));
                    return;
                }

                // Если есть проблема с авторизацией на платформе
                else if (platform.auth) {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.auth"));
                    return;
                }

                // Получаем функцию запроса данных с платформы
                const api = platform.get(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.support"));
                    return;
                }

                // Отправляем сообщение о том что запрос производится
                new message.builder().addEmbeds([
                    {
                        title: `${platform.platform}.${api.name}`,
                        description: locale._(message.locale, "api.platform.request", [env.get("loading.emoji")]),
                        color: platform.color
                    }
                ]).setTime(0).setHide(true).send = message;

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.timeout"));
                }, 10e3);

                // Получаем данные в системе API
                api.execute(argument[1] as string, { limit: db.api.limits[api.name] }).then((item) => {
                    clearTimeout(timeout);

                    // Если нет данных или была получена ошибка
                    if (item instanceof Error) {
                        db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.error", [item]));
                        return;
                    }

                    // Если был указан поиск
                    else if (item instanceof Array) {
                        db.audio.queue.events.emit("message/search", item, platform.platform, message);
                        return;
                    }

                    // Добавляем данные о платформе для плейлиста
                    if ("items" in item) item.items.map((track) => {
                        // Добавляем данные о платформе
                        track.api = {
                            platform: platform.platform,
                            color: platform.color
                        };
                    });

                    // Добавляем данные о платформе для трека
                    else if ("time" in item) {
                        // Если был получен трек являющийся потоковым
                        if (item.time.total === 0) {
                            db.audio.queue.events.emit("request/error", message, locale._(message.locale, "track.live", [platform.platform, api.name]), true);
                            return;
                        }

                        // Добавляем данные о платформе
                        item.api = {
                            platform: platform.platform,
                            color: platform.color
                        };
                    }

                    // Запускаем проигрывание треков
                    return db.audio.queue.create(message, item);
                }).catch((err: Error) => { // Отправляем сообщение об ошибке
                    console.log(err);
                    clearTimeout(timeout);
                    db.audio.queue.events.emit("request/error", message, `**${platform.platform}.${api.name}**\n\n**❯** **${err.message}**`, true);
                });
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @class request_error
 * @event request/error
 * @public
 */
class request_error extends Constructor.Assign<Handler.Event<"request/error">> {
    public constructor() {
        super({
            name: "request/error",
            type: "player",
            execute: (message, error) => {
                new message.builder().addEmbeds([
                    {
                        title: locale._(message.locale, "api.error"),
                        description: error,
                        color: Colors.DarkRed
                    }
                ]).setTime(15e3).send = message;
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({request_api, request_error});