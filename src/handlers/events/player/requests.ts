import {locale} from "@service/locale";
import {Event} from "@handler/events";
import {Colors} from "discord.js";
import {Assign} from "@utils";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class rest_request
 * @event api/request
 * @public
 */
class rest_request extends Assign<Event<"rest/request">> {
    public constructor() {
        super({
            name: "rest/request",
            type: "player",
            once: false,
            execute: async (platform, message, url) => {
                // Получаем функцию запроса данных с платформы
                const api = platform.get(typeof url === "string" ? url : url.url);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.support"));
                    return;
                }

                // Отправляем сообщение о том что запрос производится
                new message.builder().addEmbeds([
                    {
                        title: `${platform.platform}.${api.name}`,
                        description: locale._(message.locale, "api.platform.request", [db.images.loading]),
                        color: platform.color
                    }
                ]).setTime(10e3).send = message;

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.timeout"));
                }, 15e3);

                // Получаем данные в системе rest/API
                try {
                    const rest = await api.execute(url as string, { limit: db.api.limits[api.name], audio: true });
                    clearTimeout(timeout);

                    // Если нет данных или была получена ошибка
                    if (rest instanceof Error) {
                        db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.error", [rest]));
                        return;
                    }

                    // Если был произведен поиск
                    else if (rest instanceof Array) {
                        // Если не нашлись треки
                        if (rest?.length === 0 || !rest) {
                            message.FBuilder = { description: locale._(message.locale, "player.search.fail"), color: Colors.DarkRed };
                            return;
                        }

                        // Добавляем данные в очередь
                        db.queues.create(message, rest[0]);
                        return;
                    }

                    // Если надо добавить трек
                    else if ("time" in rest) {
                        // Если был получен трек являющийся потоковым
                        if (rest.time.total === 0) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "track.live", [platform.platform, "track"]));
                            return;
                        }
                    }

                    // Добавляем данные в очередь
                    db.queues.create(message, rest);
                } catch (err) {
                    clearTimeout(timeout);
                    console.error(err);
                    db.events.emitter.emit("rest/error", message, `**${platform.platform}.${api.name}**\n**❯** **${err}**`);
                }
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @class rest_error
 * @event rest/error
 * @public
 */
class rest_error extends Assign<Event<"rest/error">> {
    public constructor() {
        super({
            name: "rest/error",
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
export default Object.values({rest_request, rest_error});