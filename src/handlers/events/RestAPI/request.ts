import { MessageFlags } from "seyfert/lib/types";
import { locale, Logger } from "#structures";
import { createEvent } from "seyfert";
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
    async run(platform, ctx, url) {
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

        // Отправляем пользователю уведомление о начале запроса
        try {
            // Отправляем временное уведомление
            const message = await ctx.followup({
                flags: MessageFlags.Ephemeral,
                embeds: [{
                    title: `${platform.platform}.${api.type}`,
                    description: locale._(
                        ctx.interaction.locale,
                        platform.audio
                            ? "api.platform.request"
                            : "api.platform.request.long",
                        [db.images.loading, platform.platform]
                    ),
                    color: platform.color
                }]
            });

            setTimeout(() => message.delete().catch(() => null), 5_000);
        } catch (err) {
            // Ошибка при отправке сообщения о запросе
            Logger.log("ERROR", err as Error);
        }

        /**
         * @description Выполнение REST-запроса с таймаутом
         * @param api - Объект запроса платформы
         * @param ctx - Контекст команды
         */
        const result = await _withTimeout(
            // Основной запрос к платформе
            api.request(),

            // Таймаут выполнения запроса (15 секунд)
            15_000,

            // Ошибка по таймауту
            new Error(locale._(ctx.interaction.locale, "api.platform.timeout"))
        );

        // Если произошла ошибка — уведомляем пользователя
        if (result instanceof Error) {
            ctx.client.events.runCustom(
                "rest/error",
                ctx,
                `**${platform.platform}.${api.type}**\n**❯** **${result.message}**`
            );
            return null;
        }

        // Получаем очередь пользователя
        const queue = db.queues.set(ctx);

        // Если вернулся одиночный трек — отправляем сообщение о добавлении
        if (!Array.isArray(result)) {
            ctx.client.events.runCustom("message/push", queue, ctx.member, result);
        }

        else ctx.client.events.runCustom("message/push", queue, ctx.member, result[0]);

        // Добавляем результат (трек / список / плейлист) в очередь
        queue.tracks.push(result, ctx.author);
        return null;
    }
})

/**
 * @description Обёртка для выполнения Promise с таймаутом
 * @param promise - Основной Promise
 * @param ms - Время ожидания в миллисекундах
 * @param error - Ошибка, возвращаемая по таймауту
 */
function _withTimeout<T>(promise: Promise<T>, ms: number, error: Error): Promise<T | Error> {
    return Promise.race([
        promise,
        new Promise<Error>(resolve => setTimeout(() => resolve(error), ms))
    ]);
}