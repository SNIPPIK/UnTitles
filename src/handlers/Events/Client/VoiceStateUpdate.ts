import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";
import {db} from "@lib/db";
import {Voice} from "@lib/voice";

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
            execute: (_, oldState, newState) => setImmediate(() => {
                //TODO данный ивент должен отслеживать именно канал очереди сервера а не все гс

                const guild = oldState.guild || newState.guild;
                const voice = Voice.get(guild.id);
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

                        // Если голосовое подключение не установлено
                        if (!queue.voice.channel.members) {
                            console.log(`${guild.id}/${queue.message.channel.id}`);
                            return;
                        }

                        const members = queue.voice.channel.members.filter(member => !member.user.bot).size;

                        // Если есть пользователи
                        if (members > 0) {
                            // Снимаем плеер с паузы, если она есть!
                            if (queue.player.status === "player/pause") queue.player.resume();

                            // Если есть таймер для удаления очереди
                            if (temp) {
                                clearTimeout(temp.timeout);
                                temple_db.remove(guild.id);
                            }
                        }

                        // Если нет пользователей
                        else {
                            // Ставим плеер на паузу
                            if (queue.player.status === "player/playing") queue.player.pause();

                            // Если нет таймера для удаления очереди
                            if (!temp) temple_db.set(guild.id, {
                                guildID: guild.id,

                                // Таймер удаления очереди
                                timeout: setTimeout(() => {
                                    if (queue) db.audio.queue.remove(guild.id);
                                    if (voice) Voice.remove(guild.id);
                                }, timeout * 1e3)
                            });
                        }
                    }

                    // Если нет очереди, но есть голосовое подключение
                    else {
                        const channel = oldState?.channel || newState?.channel;
                        const members = channel.members.filter(member => !member.user.bot).size;

                        // Если есть пользователи
                        if (members > 0) return;
                        else voice.destroy();
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