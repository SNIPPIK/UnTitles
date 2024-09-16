import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Временная база данных
 */
const temple_db = new class extends Constructor.Collection<{guildID: string, timeout: NodeJS.Timeout}> {};

/**
 * @author SNIPPIK
 * @description Время для отключения бота от голосового канала
 */
const timeout = 15;

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
            execute: (client, oldState, newState) => {
                return;
                setImmediate(() => {
                    const channel = oldState?.channel || newState?.channel;
                    const me = channel.members.get(client.user.id);
                    const guild = oldState.guild || newState.guild;
                    if (!guild || !channel) return;

                    const members = channel.members.filter(member => !member.user.bot).size;
                    const meVoice = me?.voice && channel?.id === me.voice.channelId;
                    const queue = db.audio.queue.get(guild.id);
                    const temp = temple_db.get(guild.id);

                    // Если бот не в гс и есть очередь
                    if (!meVoice && queue) {
                        db.audio.queue.remove(guild.id);
                        return;
                    }

                    // Если пользователей менее 1
                    else if (members < 1) {
                        if (queue) {
                            if (queue.player.status === "player/playing") queue.player.pause();
                        }
                        if (!temp) temple_db.set(guild.id, {
                            guildID: guild.id,
                            timeout: setTimeout(() => {
                                if (queue)
                                    db.audio.queue.remove(guild.id);
                                if (meVoice)
                                    Voice.remove(guild.id);
                            }, timeout * 1e3)
                        });
                    }

                    // Если не подошли прошлые аргументы
                    else {
                        if (queue) {
                            if (queue.player.status === "player/pause") queue.player.resume();
                        }

                        if (temp) {
                            clearTimeout(temp.timeout);
                            temple_db.remove(guild.id);
                        }
                    }
                })
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({VoiceStateUpdate});