import { MessageFlags } from "seyfert/lib/types";
import { createEvent } from "seyfert";
import { db } from "#app/db";

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
            return queue.message.send_single({
                embeds: [],
                components: queue.components,
                flags: MessageFlags.IsComponentsV2
            } as any) as any;
        });

        // Меняем статус голосового канала
        db.adapter.status(queue.message.voice_id, `${db.images.disk_emoji} | ${queue.tracks.track.name}`).catch(() => null);

        // Если есть сообщение
        if (message) db.queues.cycles.messages.update(message, queue.components);
    }
})