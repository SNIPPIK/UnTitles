import { MessageFlags } from "seyfert/lib/types/index.js";
import { createEvent } from "seyfert";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Сообщение о том что сейчас играет
 * @extends Event
 * @event message/playing
 * @public
 */
export default createEvent({
    data: { name: "message/playing" },
    async run(queue) {
        const message = await db.queues.cycles.messages.ensure(queue.message.guild_id, () => {
            try {
                return queue.message.send_single({
                    embeds: null,
                    components: queue.components,
                    flags: MessageFlags.IsComponentsV2
                });
            } catch {
                return null;
            }
        });

        // Меняем статус голосового канала
        db.adapter.status(queue.message.voice_id, `${db.emoji.disk} | ${queue.tracks.track.name}`).catch(() => null);

        // Если есть сообщение
        if (message) db.queues.cycles.messages.update(message, queue.components);
    }
})