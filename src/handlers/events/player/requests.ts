import { Logger, Assign, locale } from "#structures";
import { Colors } from "#structures/discord";
import { Event } from "#handler/events";
import { Message } from "discord.js";
import { Track } from "#core/queue";
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
                const isAudio = platform.audio;
                const timeout = isAudio ? 0 : 2000;

                // Проверка поддержки запроса
                if (!api.type) {
                    return db.events.emitter.emit("rest/error", message,
                        locale._(message.locale, "api.platform.support"));
                }

                // Предупреждение о запуске запроса
                let followUpMsg: Message<boolean>;
                try {
                    followUpMsg = await message.followUp({
                        flags: "Ephemeral",
                        embeds: [{
                            title: `${platform.platform}.${api.type}`,
                            description: locale._(message.locale,
                                isAudio ? "api.platform.request" : "api.platform.request.long",
                                [db.images.loading, platform.platform]
                            ),
                            color: platform.color
                        }]
                    });
                } catch (err) {
                    console.error("Followup error:", err);
                }

                // Обёртка над таймаутом + запрос
                const timeoutPromise = new Promise<Error>((_, reject) =>
                    setTimeout(() => reject(new Error(locale._(message.locale, "api.platform.timeout"))), 15000)
                );

                let rest: Error | Track[] | Track.list | Track;
                try {
                    rest = await Promise.race([api.request(), timeoutPromise]);
                } catch (err) {
                    Logger.log("ERROR", err as Error);
                    return db.events.emitter.emit("rest/error", message,
                        `**${platform.platform}.${api.type}**\n**❯** **${err}**`);
                }

                // Очистка сообщения
                if (followUpMsg) {
                    setTimeout(() => followUpMsg.delete().catch(() => null), timeout);
                }

                // Обработка результата
                if (rest instanceof Error) {
                    return db.events.emitter.emit("rest/error", message,
                        locale._(message.locale, "api.platform.error", [rest]));
                }

                else if (Array.isArray(rest)) {
                    if (!rest.length)
                        return db.events.emitter.emit("rest/error", message,
                            locale._(message.locale, "player.search.fail"));

                    rest = rest[0];
                }

                else if ("items" in rest && rest.items.length === 0) {
                    return db.events.emitter.emit("rest/error", message,
                        locale._(message.locale, "player.search.fail"));
                }

                // Добавление в очередь
                return db.queues.create(message, rest);
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

                const options = {
                    embeds: [{
                        title: locale._(message.locale, "api.error"),
                        description: error,
                        color: Colors.DarkRed
                    }]
                }

                try {
                    let msg: any

                    if (message.replied && !message.deferred) msg = await message.followUp(options as any);
                    else if (message.deferred && !message.replied) msg = await message.editReply(options as any);
                    else if (!message.deferred && !message.replied) msg = await message.reply(options as any);
                    else msg = await message.channel.send(options as any);

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