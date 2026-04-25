import { DeclareEvent, Event, EventOn, type SupportEventCallback } from "#handler/events/index.js";
import { Colors } from "#structures/discord/index.js";
import { Logger, locale } from "#structures";
import { MessageFlags } from "discord.js";
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
       // Если было получено ничего!
       if (url === undefined) {
           db.events.emitter.emit(
               "rest/error",
               ctx,
               locale._(ctx.locale, "api.request.fail")
           );
           return null;
       }

       // Получаем описание запроса от платформы
       const api = platform.request(url);

       // Платформа не поддерживает данный тип запроса
       if (!api?.type) {
           db.events.emitter.emit(
               "rest/error",
               ctx,
               locale._(ctx.locale, "api.platform.support")
           );
           return null;
       }

       let msg: any = null, result: any = null;
       try {
           /**
            * @description Отправляем временное уведомление о начале запроса
            * @protected
            */
           msg = await ctx.followUp({
               flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
               components: [
                   {
                       type: 17,
                       accent_color: platform.color,
                       components: [
                           {
                               type: 9,
                               components: [
                                   {type: 10, content: `### ${platform.platform}.${api.type}`},
                                   {
                                       type: 10,
                                       content: `${locale._(ctx.locale, platform.audio ? "api.platform.request" : "api.platform.request.long", [db.images.loading, platform.platform])}`
                                   },
                                   {type: 10, content: `-# ${ctx.user.username}`},
                               ],
                               accessory: {
                                   type: 11,
                                   media: {
                                       url: ctx.user.avatarURL()
                                   }
                               }
                           }
                       ]
                   }
               ],
           });

           // Вставляем оригинального автора
           msg.author = ctx.user;
       } catch (err) {
           console.log(err)
       }

       /**
        * @description Выполнение REST-запроса с тайм-аутом
        * @protected
        */
       result = await _withTimeout(
           // Основной запрос к платформе
           api.request(),

           // Тайм-аут выполнения запроса (15 секунд)
           15_000,

           // Ошибка по таймауту
           new Error(locale._(ctx.locale, "api.platform.timeout"))
       ).catch(() => {
           return new Error("Request error");
       });

       // Выполняем в конце
       setImmediate(() => {
           // Если очередь была создана
           const queue = db.queues.get(ctx.guildId);

           /**
            * @description Отправляем сообщение о добавлении трека
            * @protected
            */
           db.events.emitter.emit("message/push",
               msg,
               queue,
               !Array.isArray(result) ? result : result[0],
           );
       });

       /**
        * @description Если произошла ошибка, сообщаем о ней
        * @protected
        */
       if (result instanceof Error || result["message"]) {
           db.events.emitter.emit(
               "rest/error",
               ctx,
               `**${platform.platform}.${api.type}**\n**❯** **${result["message"] ?? result}**`
           );
           return null;
       }

       /**
        * @description Создаем очередь
        * @protected
        */
       const queue = db.queues.set(ctx);
       queue.tracks.push(result, ctx.member.user); // Добавляем результат (трек / список / плейлист) в очередь
       return null;
   };
}

/**
 * @description Обёртка для выполнения Promise с таймаутом
 * @param promise - Основной Promise
 * @param ms - Время ожидания в миллисекундах
 * @param error - Ошибка, возвращаемая по тайм-ауту
 */
function _withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T | Error> {
    return Promise.race([
        promise,
        new Promise<Error>(resolve => setTimeout(() => resolve(error), ms))
    ]);
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
        queueMicrotask(async () => {
            try {
                const options: any = {
                    embeds: null,
                    components: [{
                        "type": 17, // Container
                        "accent_color": Colors.DarkRed,
                        components: [
                            {
                                "type": 9, // Block
                                "components": [
                                    {
                                        "type": 10,
                                        "content": locale._(message.locale, "api.error")
                                    },
                                    {
                                        "type": 10,
                                        "content": typeof error === "string" ? error : `\`\`\`css\n${error}\n\`\`\``
                                    }
                                ],
                                "accessory": {
                                    "type": 11,
                                    "media": {
                                        "url": message.client.user.avatarURL()
                                    }
                                }
                            },
                        ]
                    }],
                    flags: MessageFlags.IsComponentsV2
                };
                let msg: any;

                // Если бот уже ответил на сообщение
                if (message.deferred) {
                    msg = await message.followUp(options);
                }

                // Отправляем обычное сообщение
                else msg = await message.channel.send(options);

                if (msg && msg?.delete) setTimeout(() => msg.delete().catch(() => null), 15e3);
            } catch (error) {
                Logger.log("ERROR", error as Error);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [rest_request, rest_error];