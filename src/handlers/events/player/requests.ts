import {locale} from "@service/locale";
import {Event} from "@handler/events";
import {Track} from "@service/player";
import {Logger, Assign} from "@utils";
import {Colors} from "discord.js";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class rest_request
 * @event rest/request
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
                    return null;
                }

                // Отправляем сообщение о том что запрос производится
                // Сообщение о том, что запрос начался
                const followUpPromise = message.followUp({
                    flags: "Ephemeral",
                    embeds: [{
                        title: `${platform.platform}.${api.name}`,
                        description: locale._(message.locale, "api.platform.request", [db.images.loading]),
                        color: platform.color
                    }]
                });

                // Если ответ не был получен от сервера
                const timeoutPromise = new Promise((_, reject) =>
                    setTimeout(() => reject(new Error(locale._(message.locale, "api.platform.timeout"))), 15e3)
                );

                // Получаем данные в системе rest/API
                try {
                    // Дожидаемся выполнения запроса
                    const rest = await Promise.race([
                        api.execute(url as string, { limit: db.api.limits[api.name], audio: true }),
                        timeoutPromise
                    ]) as Track.list | Track[] | Track | Error;

                    // Удаляем сообщение после выполнения запроса
                    await followUpPromise.then(msg => msg.delete().catch(() => {}));

                    // Обработка ошибки если что-то пошло не так
                    if (rest instanceof Error) {
                        db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.error", [rest]));
                        return null;
                    }

                    // Если был получен результат в виде массива
                    else if (Array.isArray(rest)) {
                        if (rest.length === 0) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "track.live", [platform.platform, "track"]));
                            return null;
                        }

                        // Меняем на первый трек из массива
                        (rest as any) = rest[0];
                    }

                    // Если был получен потоковый трек с временем 0
                    else if ("time" in rest && rest.time.total === 0) {
                        db.events.emitter.emit("rest/error", message, locale._(message.locale, "track.live", [platform.platform, "track"]));
                        return;
                    }

                    // Добавляем в очередь
                    db.queues.create(message, rest as any);
                } catch (err) {
                    console.error(err);
                    db.events.emitter.emit("rest/error", message, `**${platform.platform}.${api.name}**\\n**❯** **${err}**`);
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
            execute: async (message, error) => {
                Logger.log("ERROR", `[Rest/API] ${error}`);

                return message.channel.send({
                    embeds: [{
                        title: locale._(message.locale, "api.error"),
                        description: error,
                        color: Colors.DarkRed
                    }]
                }).then((msg) => setTimeout(msg.delete, 15e3));
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [rest_request, rest_error];