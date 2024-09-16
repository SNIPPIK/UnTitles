import {API, Constructor, Handler} from "@handler";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class userRequestAPI
 */
class userRequestAPI extends Constructor.Assign<Handler.Event<"request/api">> {
    public constructor() {
        super({
            name: "request/api",
            type: "player",
            execute: (message, argument) => {
                const platform = new API.response(argument[0] as string);

                // Если платформа заблокирована
                if (platform.block) {
                    db.audio.queue.events.emit("request/error", message, `APIs block: This platform has currently been blocked by the developer.`);
                    return;
                }

                // Если есть проблема с авторизацией на платформе
                else if (platform.auth) {
                    db.audio.queue.events.emit("request/error", message, `APIs auth: Problem with authorization data, contact the developer`);
                    return;
                }

                // Получаем функцию запроса данных с платформы
                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.audio.queue.events.emit("request/error", message, `APIs error: I don't have support for this type of request`);
                    return;
                }

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.audio.queue.events.emit("request/error", message, `Timeout server: The server refused to transmit data`);
                }, 10e3);

                // Получаем данные в системе API
                api.callback(argument[1] as string, { limit: db.api.limits[api.name], audio: true }).then((item) => {
                    clearTimeout(timeout);

                    // Если нет данных или была получена ошибка
                    if (item instanceof Error) {
                        db.audio.queue.events.emit("request/error", message, `Critical Error: ${item}`);
                        return;
                    }

                    // Если был указан поиск
                    else if (item instanceof Array) {
                        db.audio.queue.events.emit("message/search", item, platform.platform, message);
                        return;
                    }

                    // Запускаем проигрывание треков
                    return db.audio.queue.create(message, item);
                }).catch((err: Error) => { // Отправляем сообщение об ошибке
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
 * @class userRequestError
 */
class userRequestError extends Constructor.Assign<Handler.Event<"request/error">> {
    public constructor() {
        super({
            name: "request/error",
            type: "player",
            execute: (_, error) => {
                console.log(error);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({userRequestAPI, userRequestError});