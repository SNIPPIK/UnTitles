import { createEvent, WebhookMessage } from "seyfert";
import { MessageFlags } from "seyfert/lib/types";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Выполнение запроса пользователя через внутреннее API
 * @extends Event
 * @event rest/request
 * @public
 */
export default createEvent({
    data: { name: 'rest/request' },
    run: async (platform, ctx, url) => {
        // Если было получено ничего!
        if (url === undefined) {
            await ctx.client.events.runCustom(
                "rest/error",
                ctx,
                locale._(ctx.interaction.locale, "api.request.fail")
            );
            return null;
        }


        // Получаем описание запроса от платформы
        const api = platform.request(url);

        // Платформа не поддерживает данный тип запроса
        if (!api?.type) {
            await ctx.client.events.runCustom(
                "rest/error",
                ctx,
                locale._(ctx.interaction.locale, "api.platform.support")
            );
            return null;
        }

        let msg: WebhookMessage = null, result: any = null;
        try {
            /**
             * @description Отправляем временное уведомление о начале запроса
             * @protected
             */
            msg = await ctx.followup({
                flags: MessageFlags.IsComponentsV2,
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
                                        content: `${locale._(ctx.interaction.locale, platform.audio ? "api.platform.request" : "api.platform.request.long", [db.images.loading, platform.platform])}`
                                    },
                                    {type: 10, content: `-# ${ctx.author.username}`},
                                ],
                                accessory: {
                                    type: 11,
                                    media: {
                                        url: ctx.author.avatarURL()
                                    }
                                }
                            }
                        ]
                    }
                ],
            });

            // Вставляем оригинального автора
            msg.author = ctx.author;
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
            new Error(locale._(ctx.interaction.locale, "api.platform.timeout"))
        ).catch(() => {
            return new Error("Request error");
        });

        // Выполняем в конце
        setImmediate(async () => {
            // Если очередь была создана
            const queue = db.queues.get(ctx.guildId);

            /**
             * @description Отправляем сообщение о добавлении трека
             * @protected
             */
            await ctx.client.events.runCustom("message/push",
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
            await ctx.client.events.runCustom(
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
        queue.tracks.push(result, ctx.author); // Добавляем результат (трек / список / плейлист) в очередь
        return null;
    }
})

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