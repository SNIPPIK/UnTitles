import { MessageFlags } from "seyfert/lib/types";
import { Colors } from "#structures/discord";
import { locale, Logger } from "#structures";
import { createEvent } from "seyfert";

/**
 * @author SNIPPIK
 * @description Если при выполнении запроса пользователя произошла ошибка
 * @extends Event
 * @event rest/error
 * @public
 */
export default createEvent({
    data: { name: 'rest/error' },
    run: (message, error, client) => {
        queueMicrotask(async () => {
            try {
                const options = {
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
                                        "content": locale._(message.interaction.locale, "api.error")
                                    },
                                    {
                                        "type": 10,
                                        "content": typeof error === "string" ? error : `\`\`\`css\n${error}\n\`\`\``
                                    }
                                ],
                                "accessory": {
                                    "type": 11,
                                    "media": {
                                        "url": message.client.me.avatarURL()
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
                    msg = await message.followup(options);
                }

                // Отправляем обычное сообщение
                else msg = await client.messages.write(message.channelId, options);

                if (msg && msg?.delete) setTimeout(() => msg.delete().catch(() => null), 15e3);
            } catch (error) {
                Logger.log("ERROR", error as Error);
            }
        });

        return null;
    }
})