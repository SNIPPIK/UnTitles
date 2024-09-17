import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {db} from "@lib/db";
import {Voice} from "@lib/voice";

/**
 * @author SNIPPIK
 * @description Класс ивента VoiceStateUpdate
 * @class VoiceStateUpdate
 */
class VoiceStateUpdate extends Constructor.Assign<Handler.Event<Events.VoiceStateUpdate>> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            type: "client",
            execute: (_, oldState, newState) => {
                const state = newState ?? oldState;

                // Если бота нет в гс на этом сервере, то игнорируем
                if (!state.guild.members.me.voice.channel) return;

                const members = state.guild.members.me.voice.channel.members.filter(member => !member.user.bot).size;

                if (members === 0) {
                    const queue = db.audio.queue.get(state.guild.id);

                    // Если есть очередь, то удаляем ее
                    if (queue) queue.cleanup();
                    Voice.remove(state.guild.id);
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({VoiceStateUpdate});