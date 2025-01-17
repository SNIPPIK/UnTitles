import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {db} from "@service/db";

/**
 * @author SNIPPIK
 * @description Временная база данных
 */
const temple_db = new Map<string, NodeJS.Timeout>();

/**
 * @author SNIPPIK
 * @description Время для отключения бота от голосового канала
 */
const timeout = 15;

/**
 * @author SNIPPIK
 * @description Класс события VoiceStateUpdate
 * @class VoiceStateUpdate
 * @event Events.VoiceStateUpdate
 * @public
 */
class VoiceStateUpdate extends Constructor.Assign<Handler.Event<Events.VoiceStateUpdate>> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            type: "client",
            once: false,
            execute: (_, oldState, newState) => setImmediate(() => {
                const guild = oldState.guild || newState.guild;
                const voice = db.voice.get(guild.id);
                const queue = db.audio.queue.get(guild.id);
                const temp = temple_db.get(guild.id);


                // Если нет гс, то не продолжаем
                if (!voice && !queue) return;

                // Если бота нет в голосовом канале, но есть очередь
                else if (!voice && queue) return db.audio.queue.remove(guild.id);

                // Если есть голосовое подключение
                else {
                    // Если есть очередь на сервере и голосовое подключение
                    if (queue) {
                        const members = oldState.guild.members.me.voice.channel?.members?.filter(member => !member.user.bot).size ?? 0;

                        // Если есть пользователи
                        if (members > 0) {
                            // Снимаем плеер с паузы, если она есть!
                            if (queue.player.status === "player/pause") queue.player.resume();

                            // Если есть таймер для удаления очереди
                            if (temp) {
                                clearTimeout(temp);
                                temple_db.delete(guild.id);
                            }
                        }

                        // Если нет пользователей
                        else {
                            // Ставим плеер на паузу
                            if (queue.player.status === "player/playing") queue.player.pause();

                            // Если нет таймера для удаления очереди
                            if (!temp) temple_db.set(guild.id, setTimeout(() => {
                                if (queue) db.audio.queue.remove(guild.id);
                                if (voice) db.voice.remove(guild.id);
                            }, timeout * 1e3));
                        }
                    }

                    // Если нет очереди, но есть голосовое подключение
                    else {
                        const members = oldState.guild.members.me.voice.channel?.members?.filter(member => !member.user.bot).size;

                        // Если есть пользователи
                        if (members > 0) return;
                        else db.voice.remove(guild.id);
                    }
                }
            })
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({VoiceStateUpdate});