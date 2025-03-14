import {Logger, Assign, Interact} from "@utils";
import {APIRequest} from "@handler/apis";
import {locale} from "@service/locale";
import {Track} from "@service/player";
import {Event} from "@handler/events";
import {Colors} from "discord.js";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class request_api
 * @event request/api
 * @public
 */
class request_api extends Assign<Event<"request/api">> {
    public constructor() {
        super({
            name: "request/api",
            type: "player",
            once: false,
            execute: (message, argument) => {
                const platform = db.api.request(this._parseArgument(argument, 0));

                // Если платформа заблокирована
                if (platform.block) {
                    db.events.emitter.emit("request/error", message, locale._(message.locale, "api.platform.block"));
                    return;
                }

                // Если есть проблема с авторизацией на платформе
                else if (platform.auth) {
                    db.events.emitter.emit("request/error", message, locale._(message.locale, "api.platform.auth"));
                    return;
                }

                // Получаем функцию запроса данных с платформы
                const api = platform.get(this._parseArgument(argument, 1));

                // Если нет поддержки такого запроса!
                if (!api || !api.name) {
                    db.events.emitter.emit("request/error", message, locale._(message.locale, "api.platform.support"));
                    return
                }


                // Если ответ не был получен от сервера
                const timeout = setTimeout(() => {
                    db.events.emitter.emit("request/error", message, locale._(message.locale, "api.platform.timeout"));
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
                api.execute(argument[1] as any, { limit: db.api.limits[api.name], audio: false })

                    // Получаем данные
                    .then((item) => {
                        // Если нет данных или была получена ошибка
                        if (item instanceof Error) {
                            Logger.log("ERROR", `request/api - ${item}`);
                            db.events.emitter.emit("request/error", message, locale._(message.locale, "api.platform.error", [item]));
                            return;
                        }

                        // Если был произведен поиск
                        if (item instanceof Array) {
                            db.events.emitter.emit("message/search", item, platform.platform, message);
                            return;
                        }

                        // Если надо добавить плейлист
                        else if ("items" in item) item.items.map((track: Track) => {
                            // Добавляем данные о платформе
                            track.api = {
                                platform: platform.platform,
                                color: platform.color
                            };
                        });

                        // Если надо добавить трек
                        else if ("time" in item) {
                            // Если был получен трек являющийся потоковым
                            if (item.time.total === 0) {
                                db.events.emitter.emit("request/error", message, locale._(message.locale, "track.live", [platform.platform, "track"]));
                                return;
                            }

                            // Добавляем данные о платформе
                            item.api = {
                                platform: platform.platform,
                                color: platform.color
                            };
                        }

                        // Добавляем данные в очередь
                        db.queues.create(message, item);
                    })

                    // Обрабатываем ошибки
                    .catch((err: Error) => { // Отправляем сообщение об ошибке
                        console.error(err);
                        db.events.emitter.emit("request/error", message, `**${platform.platform}.${api.name}**\n**❯** **${err.message}**`);
                    })

                    // Действие в конце
                    .finally(() => {
                        // Удаляем timeout
                        clearTimeout(timeout);
                    });
            }
        });
    };

    /**
     * @description Вытаскиваем конкретный объект из array
     * @param argument - Аргументы в формате array
     * @param pos - Позиция аргумента
     * @readonly
     * @private
     */
    private readonly _parseArgument = (argument: any[], pos: number): string => {
        return typeof argument[pos] !== "string" ? argument[pos].url : argument[pos];
    };
}

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @class request_error
 * @event request/error
 * @public
 */
class request_error extends Assign<Event<"request/error">> {
    public constructor() {
        super({
            name: "request/error",
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
export default Object.values({request_api, request_error});