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
                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                // Получаем данные в системе API
                api.callback(argument[1] as string, { limit: db.api.limits[api.name], audio: true }).then((item) => {
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