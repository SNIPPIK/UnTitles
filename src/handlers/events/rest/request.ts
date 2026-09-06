import { MessageFlags } from "seyfert/lib/types/index.js";
import { createEvent, WebhookMessage } from "seyfert";
import { locale } from "#structures";
import { db } from "#db";

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
        // Если URL не был получен
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

        let msg: WebhookMessage | null = null;

        try {
            /**
             * Отправляем временное уведомление о начале запроса
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
                                    {
                                        type: 10,
                                        content: `### ${platform.platform}.${api.type}`,
                                    },
                                    {
                                        type: 10,
                                        content: locale._(
                                            ctx.interaction.locale,
                                            platform.audio
                                                ? "api.platform.request"
                                                : "api.platform.request.long",
                                            [
                                                db.emoji.loading,
                                                platform.platform,
                                            ]
                                        ),
                                    },
                                    {
                                        type: 10,
                                        content: `-# ${ctx.author.username}`,
                                    },
                                ],

                                accessory: {
                                    type: 11,
                                    media: {
                                        url: ctx.author.avatarURL(),
                                    },
                                },
                            },
                        ],
                    },
                ],
            });

            // Вставляем оригинального автора
            msg.author = ctx.author;
        } catch (err) {
            console.log(err);
        }

        /**
         * Выполняем REST-запрос
         */
        const result = await api.request();

        /**
         * Если произошла ошибка — сразу выходим.
         *
         * Важно: message/push ещё НЕ вызываем.
         */
        if (result instanceof Error || result?.["message"]) {
            await ctx.client.events.runCustom(
                "rest/error",
                ctx,
                `**${platform.platform}.${api.type}**\n**❯** **${result?.["message"] ?? result}**`
            );

            return null;
        }

        /**
         * Создаём очередь только после успешного REST-запроса.
         */
        const queue = db.queues.set(ctx);

        /**
         * Добавляем результат в очередь.
         */
        const track = !Array.isArray(result)
            ? result
            : result[0];

        queue.tracks.push(result, ctx.author);

        /**
         * Отправляем сообщение о добавлении трека.
         *
         * setImmediate здесь уже безопасен:
         * result точно успешный,
         * queue точно существует,
         * track существует.
         */
        setImmediate(async () => {
            try {
                await ctx.client.events.runCustom(
                    "message/push",
                    msg,
                    queue,
                    track,
                );
            } catch (err) {
                console.error(err);
            }
        });

        return null;
    },
});