import { Event } from "#handler/events";
import { Assign } from "#structures";
import { Events } from "discord.js";
import { db } from "#app/db";

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
 * @extends Assign
 * @event Events.VoiceStateUpdate
 * @public
 */
class VoiceStateUpdate extends Assign<Event<Events.VoiceStateUpdate>> {
    public constructor() {
        super({
            name: Events.VoiceStateUpdate,
            type: "client",
            once: false,
            execute: (oldState, newState) => queueMicrotask(() => {
                const guild = oldState.guild || newState.guild;
                const guildID = guild.id;

                const voice = db.voice.get(guildID);
                const queue = db.queues.get(guildID);
                const temp = temple_db.get(guildID);

                // Если нет гс и очереди, то не продолжаем
                if (!voice && !queue) return;

                // Если бота нет в голосовом канале, но есть очередь
                else if (!voice && queue) db.queues.remove(guildID);

                // Если есть гс, но нет очереди
                else if (voice && !queue) {
                    const members = guild.members.me.voice.channel?.members?.filter(member => !member.user.bot).size ?? 0;

                    // Если есть пользователи
                    if (members == 0) db.voice.remove(guildID);
                }

                // Если есть гс и очередь
                else {
                    const meVoice = !!guild.members.me.voice.channel?.members?.find(member => member.id === guild.members.me.id);

                    // Если бота выгнали из голосового канала
                    if (!meVoice) {
                        db.voice.remove(guildID);
                        db.queues.remove(guildID);
                    }

                    const members = guild.members.me.voice.channel?.members?.filter(member => !member.user.bot).size ?? 0;

                    // Если есть пользователи
                    if (members > 0) {
                        // Если есть таймер для удаления очереди
                        if (temp) {
                            clearTimeout(temp);
                            temple_db.delete(guildID);

                            // Снимаем плеер с паузы, если она есть!
                            if (queue && queue?.player?.status === "player/pause") queue.player.resume();
                        }
                    }

                    // Если нет пользователей
                    else {
                        // Если нет таймера для удаления очереди
                        if (!temp) {
                            // Ставим плеер на паузу
                            if (queue && queue?.player?.status === "player/playing") queue.player.pause();

                            temple_db.set(guildID, setTimeout(() => {
                                if (queue) db.queues.remove(guildID);
                                if (voice) db.voice.remove(guildID);
                            }, timeout * 1e3));
                        }
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
export default [VoiceStateUpdate];