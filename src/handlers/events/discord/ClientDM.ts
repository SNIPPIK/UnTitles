import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events/index.js";
import { SpeakerType } from "#core/voice/structures/Speaker.js";
import { Events } from "discord.js";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс события MessageCreate
 * @class ClientDM
 * @extends Event
 * @event Events.MessageCreate
 * @public
 */
@EventOn()
@DeclareEvent({
    name: Events.MessageCreate,
    type: "client"
})
class ClientDM extends Event<Events.MessageCreate> {
    run: SupportEventCallback<Events.MessageCreate> = (ctx) => {
        if (ctx.call && ctx.reference) {
            const voice = db.voice.get(ctx.reference.guildId);

            // Если нет гс подключения
            if (!voice) {
                db.voice.join({
                    channel_id: ctx.reference.channelId,
                    guild_id: ctx.reference.guildId,
                    self_mute: false,
                    self_deaf: true,
                    self_speaker: SpeakerType.priority
                }, db.adapter.voiceAdapterCreator(ctx.reference.guildId));
            }
        }

        ctx = null;
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [ClientDM];