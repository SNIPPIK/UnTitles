import {API, Constructor, Handler} from "@handler";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {db} from "@lib/db";
import {env} from "@env";

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
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.block"));
                    return;
                }

                // Если есть проблема с авторизацией на платформе
                else if (platform.auth) {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.auth"));
                    return;
                }

                // Получаем функцию запроса данных с платформы
                const api = platform.find(typeof argument[1] !== "string" ? argument[1].url : argument[1]);

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.support"));
                    return;
                }

                // Отправляем сообщение о том что запрос производится
                message.fastBuilder = {
                    title: `${platform.platform}.${api.name}`,
                    description: locale._(message.locale, "api.platform.request", [env.get("loading.emoji")]),
                    color: platform.color
                };

                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.audio.queue.events.emit("request/error", message, locale._(message.locale, "api.platform.timeout"));
                }, 10e3);

                // Получаем данные в системе API
                api.callback(argument[1] as string, { limit: db.api.limits[api.name], audio: true }).then((item) => {
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

                    else if ("duration" in item) {
                        if (item.duration.seconds === 0) {
                            db.audio.queue.events.emit("request/error", message, locale._(message.locale, "track.live", [platform.platform, api.name]), true);
                            return
                        }
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
 * @description Проверяем можно ли включить трек с плавным проигрыванием
 * @class userRequestTime
 */
class userRequestTime extends Constructor.Assign<Handler.Event<"request/time">> {
    public constructor() {
        super({
            name: "request/time",
            type: "player",
            execute: (queue, position) => {
                const old = queue.songs.position;

                // Меняем позицию трека в очереди
                if (queue.player.stream.current.duration < queue.songs.song.duration.seconds + 10) {
                    queue.songs.swapPosition = position;
                    queue.player.play(queue.songs.song);

                    // Если не получилось начать чтение следующего трека
                    queue.player.stream.current.stream.once("error", () => {
                        // Возвращаем прошлый номер трека
                        queue.songs.swapPosition = old;
                    });
                } else {
                    // Если надо вернуть прошлый трек, но времени уже нет!
                    if (queue.songs.position > position) queue.songs.swapPosition = position - 1;
                    queue.player.stop();
                }
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
export default Object.values({userRequestAPI, userRequestError, userRequestTime});