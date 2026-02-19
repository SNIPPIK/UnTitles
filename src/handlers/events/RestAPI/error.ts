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
    async run(message, error) {
        try {
            const msg = await message.followup({
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
                                    "content": `\`\`\`css\n${error}\n\`\`\``
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
                flags: MessageFlags.Ephemeral
            });

            if (msg && !!msg?.delete) setTimeout(() => msg.delete().catch(() => null), 15e3);
        } catch (error) {
            Logger.log("ERROR", error as Error);
        }
    }
})