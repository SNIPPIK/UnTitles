import { Colors, CommandInteraction } from "#structures/discord";
import { Logger, Assign, locale } from "#structures";
import type { RestClientSide } from "#handler/rest";
import type { Event } from "#handler/events";
import type { Track } from "#core/queue";
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
            execute: async (platform, ctx, url) => {
                // Получаем функцию запроса данных с платформы
                const api = platform.request(url);

                // Проверка поддержки запроса
                if (!api?.type) return db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.support"));

                // Предупреждение о запуске запроса
                const message = await this._sendRequestMessage(ctx, platform, api.type);

                let rest: Error | Track[] | Track.list | Track;
                try {
                    rest = await Promise.race([api.request(),
                        new Promise<Error>((resolve) => {
                            setTimeout(() => resolve(new Error(locale._(ctx.locale, "api.platform.timeout"))), 15e3)
                        })
                    ]);

                    if (message) message();
                } catch (err) {
                    if (message) message();
                    Logger.log("ERROR", err as Error);
                    return db.events.emitter.emit("rest/error", ctx,`**${platform.platform}.${api.type}**\n**❯** **${err}**`);
                }

                // Обработка результата
                if (rest instanceof Error) return db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.error", [rest]));

                // Добавление в очередь
                return db.queues.create(ctx, rest);
            }
        });
    };

    /**
     * @description Отправка сообщение о начале запроса
     * @param ctx - Сообщение пользователя
     * @param platform - Класс для запроса
     * @param type - Тип запроса
     * @private
     */
    private _sendRequestMessage = async (ctx: CommandInteraction, platform: RestClientSide.Request, type: string) => {
        const isAudio = platform.audio;

        try {
            // Отправляем сообщение
             const message = await ctx.followUp({
                flags: "Ephemeral",
                embeds: [{
                    title: `${platform.platform}.${type}`,
                    description: locale._(ctx.locale,
                        isAudio ? "api.platform.request" : "api.platform.request.long",
                        [db.images.loading, platform.platform]
                    ),
                    color: platform.color
                }]
            });

            // Отправляем функцию для удаления
            return () => setTimeout(() => message.delete().catch(() => null), 5e3);
        } catch (err) {
            Logger.log("ERROR", err as Error);
            return null;
        }
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
                };

                try {
                    let msg = await message.followUp(options);
                    setTimeout(() => msg.delete().catch(() => null), 15e3);
                } catch (err) {
                    try {
                        let msg = await message.channel.send(options);
                        setTimeout(() => msg.deletable ? msg.delete().catch(() => null) : null, 15e3);
                    } catch (err) {
                        console.error(err);
                    }
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