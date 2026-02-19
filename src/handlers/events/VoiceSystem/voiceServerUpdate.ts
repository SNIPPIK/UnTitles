import { createEvent } from 'seyfert';
import { db } from "#app/db";

export default createEvent({
    data: { name: 'voiceServerUpdate' },
    async run(packet) {
        // Send data in adapter
        return db.adapter.onVoiceServer({ ...packet, guild_id: packet.guildId });
    }
});