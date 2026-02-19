import { createEvent } from "seyfert";
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

export default createEvent({
    data: { name: "voiceStateUpdate" },
    async run(state) {
        const payload = state[0];

        // If not found voice data
        if (!payload) return;

        // Send data in adapter
        db.adapter.onVoiceStateUpdate({
            session_id: payload.sessionId,
            channel_id: payload.channelId,
            guild_id: payload.guildId,
            user_id: payload.userId,

            self_stream: payload.selfStream,
            self_video: payload.selfVideo,
            self_mute: payload.selfMute,
            self_deaf: payload.selfDeaf,
            request_to_speak_timestamp: payload.requestToSpeakTimestamp,

            deaf: payload.deaf,
            mute: payload.mute,
            suppress: payload.suppress,
            member: null
        });


        setImmediate(async () => {
            const guild = payload.guild("cache");
            const voice = db.voice.get(guild.id);
            const queue = db.queues.get(guild.id);
            const temp = temple_db.get(guild.id);

            // Если нет гс и очереди, то не продолжаем
            if (!voice && !queue) return;

            // Если бота нет в голосовом канале, но есть очередь
            else if (!voice && queue) db.queues.remove(guild.id);

            // Если есть гс, но нет очереди
            else if (voice && !queue) {
                const members = (await payload?.channel("cache")?.members())?.filter((user) => !user.bot)?.length ?? 0;

                // Если есть пользователи
                if (members === 0) db.voice.remove(guild.id);
            }

            // Если есть гс и очередь
            else {
                const members = (await payload?.channel("cache")?.members())?.filter((user) => !user.bot)?.length ?? 0;

                // Если есть пользователи
                if (members > 0) {
                    // Если есть таймер для удаления очереди
                    if (temp) {
                        clearTimeout(temp);
                        temple_db.delete(guild.id);

                        // Снимаем плеер с паузы, если она есть!
                        if (queue.player.status === "player/pause") queue.player.resume();
                    }
                }

                // Если нет пользователей
                else {
                    // Если нет таймера для удаления очереди
                    if (!temp) {
                        // Ставим плеер на паузу
                        if (queue.player.status === "player/playing") queue.player.pause();

                        temple_db.set(guild.id, setTimeout(() => {
                            if (queue) db.queues.remove(guild.id);
                            if (voice) db.voice.remove(guild.id);
                        }, timeout * 1e3));
                    }
                }
            }
        });
    }
});