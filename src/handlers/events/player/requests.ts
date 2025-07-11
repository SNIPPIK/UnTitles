import { Colors, Message } from "discord.js";
import { Logger, Assign } from "#structures";
import { locale } from "#service/locale";
import { Event } from "#handler/events";
import { Track } from "#service/player";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class rest_request
 * @extends Assign
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
                const api = platform.request(url);
                const timeout = !platform.audio ? 2e3 : 0;

                // Если нет поддержки такого запроса!
                if (!api.type) {
                    db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.support"));
                    return;
                }

                // Отправляем сообщение о том что запрос производится
                // Сообщение о том, что запрос начался
                let followUpPromise: Message<boolean>
                try {
                    followUpPromise = await message.followUp({
                        flags: "Ephemeral",
                        embeds: [{
                            title: `${platform.platform}.${api.type}`,
                            description: timeout ? locale._(message.locale, "api.platform.request.long", [db.images.loading, platform.platform]) : locale._(message.locale, "api.platform.request", [db.images.loading]),
                            color: platform.color
                        }]
                    });
                } catch (err) {
                    console.error(err);
                }

                // Получаем данные в системе rest/API
                try {
                    // Если ответ не был получен от сервера
                    const timeoutPromise = new Promise((_, reject) =>
                        setTimeout(() => reject(new Error(locale._(message.locale, "api.platform.timeout"))), 15e3)
                    );

                    // Дожидаемся выполнения запроса
                    let rest = await Promise.race([api.request(), timeoutPromise]) as Track.list | Track[] | Track | Error;

                    try {
                        // Удаляем сообщение после выполнения запроса
                        if (followUpPromise) setTimeout(() => followUpPromise.deletable ? followUpPromise.delete().catch(() => null) : {}, timeout);
                    } catch (err) {
                        console.error(err);
                    }

                    // Обработка ошибки если что-то пошло не так
                    if (rest instanceof Error) {
                        db.events.emitter.emit("rest/error", message, locale._(message.locale, "api.platform.error", [rest]));
                        return;
                    }

                    // Если был получен результат в виде массива
                    else if (Array.isArray(rest)) {
                        if (rest.length === 0) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "player.search.fail"));
                            return;
                        }
                        // Меняем на первый трек из массива
                        rest = rest[0];
                    }

                    // Если найден плейлист
                    else if ("items" in rest) {
                        if (rest.items.length === 0) {
                            db.events.emitter.emit("rest/error", message, locale._(message.locale, "player.search.fail"));
                            return;
                        }
                    }

                    // Добавляем в очередь
                    db.queues.create(message, rest);
                } catch (err) {
                    console.error(err);
                    db.events.emitter.emit("rest/error", message, `**${platform.platform}.${api.type}**\n**❯** **${err}**`);
                }
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @class rest_error
 * @extends Assign
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

                try {
                    const msg = await message.channel.send({
                        embeds: [{
                            title: locale._(message.locale, "api.error"),
                            description: error,
                            color: Colors.DarkRed
                        }]
                    });

                    if (msg.deletable) setTimeout(msg.delete, 15e3);
                } catch (err) {
                    console.error(err);
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [rest_request, rest_error];