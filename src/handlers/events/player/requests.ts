import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { Colors, type CommandInteraction } from "#structures/discord";
import type { RestClientSide} from "#handler/rest";
import { Logger, locale } from "#structures";
import type { Track } from "#core/queue";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @class rest_request
 * @extends Event
 * @event rest/request
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "rest/request",
    type: "player"
})
class rest_request extends Event<"rest/request"> {
   run: SupportEventCallback<"rest/request"> = async (platform, ctx, url) => {
       // Получаем функцию запроса данных с платформы
       const api = platform.request(url);

       // Проверка поддержки запроса
       if (!api?.type) return db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.support"));

       // Предупреждение о запуске запроса
       const message = await this._sendRequestMessage(ctx, platform, api.type);

       let rest: Error | Track[] | Track.list | Track;
       try {
           rest = await Promise.race(
               [
                   // Делаем запрос к платформе
                   api.request(),

                   // Создаем обертку с таймером по достижению которого будет выдана ошибка вместо запроса
                   new Promise<Error>((resolve) => {
                       setTimeout(() => resolve(new Error(locale._(ctx.locale, "api.platform.timeout"))), 15e3)
                   })
               ]
           );

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
 * @extends Event
 * @event rest/error
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "rest/error",
    type: "player"
})
class rest_error extends Event<"rest/error"> {
    run: SupportEventCallback<"rest/error"> = async (message, error) => {
        const options = {
            embeds: [{
                title: locale._(message.locale, "api.error"),
                description: `${error}`,
                color: Colors.DarkRed
            }]
        };

        try {
            let msg = await message.followUp(options);
            setTimeout(() => msg.delete().catch(() => null), 15e3);
        } catch (err) {
            Logger.log("ERROR", err as Error);

            try {
                let msg = await message.channel.send(options);
                setTimeout(() => msg.deletable ? msg.delete().catch(() => null) : null, 15e3);
            } catch (err) {
                Logger.log("ERROR", err as Error);
            }
        }
    }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [rest_request, rest_error];