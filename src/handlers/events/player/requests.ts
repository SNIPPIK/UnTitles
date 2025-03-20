import {locale} from "@service/locale";
import {Event} from "@handler/events";
import {Logger, Assign} from "@utils";
import {Colors} from "discord.js";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class api_request
 * @event api/request
 * @public
 */
class api_request extends Assign<Event<"api/request">> {
    public constructor() {
        super({
            name: "api/request",
            type: "player",
            once: false,
            execute: (platform, message, url) => {
                // Получаем функцию запроса данных с платформы
                const api = platform.get(url);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.events.emitter.emit("api/error", message, locale._(message.locale, "api.platform.support"));
                    return
                }

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.events.emitter.emit("api/error", message, locale._(message.locale, "api.platform.timeout"));
                }, 10e3);

                // Отправляем сообщение о том что запрос производится
                new message.builder().addEmbeds([
                    {
                        title: `${platform.platform}.${api.name}`,
                        description: locale._(message.locale, "api.platform.request", [db.images.loading]),
                        color: platform.color
                    }
                ]).setTime(10e3).send = message;


                // Получаем данные в системе API
                api.execute(url, { limit: db.api.limits[api.name], audio: false })
                    // Получаем данные
                    .then((item) => {
                        // Если нет данных или была получена ошибка
                        if (item instanceof Error) {
                            Logger.log("ERROR", `request/api - ${item}`);
                            db.events.emitter.emit("api/error", message, locale._(message.locale, "api.platform.error", [item]));
                            return;
                        }

                        // Если был произведен поиск
                        if (item instanceof Array) {
                            db.events.emitter.emit("message/search", item, platform.platform, message);
                            return;
                        }

                        // Если надо добавить трек
                        else if ("time" in item) {
                            // Если был получен трек являющийся потоковым
                            if (item.time.total === 0) {
                                db.events.emitter.emit("api/error", message, locale._(message.locale, "track.live", [platform.platform, "track"]));
                                return;
                            }

                            // Сохраняем кеш в системе
                            db.cache.set(item);
                        }

                        // Добавляем данные в очередь
                        db.queues.create(message, item);
                    })

                    // Обрабатываем ошибки
                    .catch((err: Error) => { // Отправляем сообщение об ошибке
                        console.error(err);
                        db.events.emitter.emit("api/error", message, `**${platform.platform}.${api.name}**\n**❯** **${err.message}**`);
                    })

                    // Действие в конце
                    .finally(() => {
                        // Удаляем timeout
                        clearTimeout(timeout);
                    });
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @class api_error
 * @event api/error
 * @public
 */
class api_error extends Assign<Event<"api/error">> {
    public constructor() {
        super({
            name: "api/error",
            type: "player",
            once: false,
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
export default Object.values({api_request, request_error: api_error});