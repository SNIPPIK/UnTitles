import { DeclareEvent, EventOn, Event, SupportEventCallback } from "#handler/events";
import { MessageFlags } from "discord-api-types/v10";
import { Colors } from "#structures/discord";
import { locale } from "#structures";

/**
 * @author SNIPPIK
 * @description Сообщение о завершении проигрывания
 * @class queue_cleanup
 * @extends Event
 * @event queue/cleanup
 * @public
 */
@EventOn()
@DeclareEvent({
    name: "queue/cleanup",
    type: "player"
})
class queue_cleanup extends Event<"queue/cleanup"> {
    run: SupportEventCallback<"queue/cleanup"> = async (queue) => {
        const { tracks, player } = queue;

        try {
            const msg = await queue.message.send({
                withResponse: true,
                flags: MessageFlags.IsComponentsV2,
                components: [
                    {
                        "type": 17, // Container
                        "accent_color": Colors.White,
                        "components": [
                            {
                                "type": 9, // Block
                                "components": [
                                    {
                                        "type": 10,
                                        "content": locale._(queue.message.locale, "queue.cleanup")
                                    },
                                ],
                                "accessory": {
                                    "type": 11,
                                    //"description": name, // Подсказка
                                    "media": {
                                        "url": queue.message.guild.iconURL(),
                                    }
                                }
                            },
                            {
                                "type": 14, // Separator
                                "divider": true,
                                "spacing": 1
                            },
                            {
                                "type": 10, // Text
                                "content": `> -# \`${player.audio.volumeIndicator}\` ${tracks.footer}`
                            },
                        ]
                    }
                ]
            });
            setTimeout(() => msg.delete?.().catch(() => null), 50e3);
        } catch (err) {
            console.log(err);
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [queue_cleanup];