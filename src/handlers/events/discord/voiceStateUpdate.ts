import { createEvent } from "seyfert";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Таймеры автоматического выхода
 */
const timers = new Map<string, NodeJS.Timeout>();

/**
 * @author SNIPPIK
 * @description Время ожидания перед отключением (сек.)
 */
const TIMEOUT = 60;

/**
 * Отменить таймер выхода
 */
function clearLeaveTimer(guildId: string) {
    const timer = timers.get(guildId);
    if (!timer) return;

    clearTimeout(timer);
    timers.delete(guildId);
}

export default createEvent({
    data: {
        name: "voiceStateUpdate"
    },
    run: ([newState, oldState], client) => {
        const payload = newState ?? oldState;
        if (!payload) return;

        const { guildId, userId } = payload;

        /**
         * ==========================================================
         * СОБЫТИЯ НАШЕГО БОТА
         * ==========================================================
         */
        if (userId === client.botId) {
            // Обновляем VoiceAdapter
            db.adapter.onVoiceStateUpdate({
                session_id: payload.sessionId,
                channel_id: payload.channelId,
                guild_id: guildId,
                user_id: userId,
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

            /**
             * Если именно НАШ бот покинул голосовой канал —
             * полностью удаляем очередь.
             */
            if (!payload.channelId) {
                clearLeaveTimer(guildId);

                db.queues.remove(guildId);
                db.voice.remove(guildId);
            }

            return;
        }

        /**
         * ==========================================================
         * СОБЫТИЯ ВСЕХ ОСТАЛЬНЫХ ПОЛЬЗОВАТЕЛЕЙ
         * ==========================================================
         */
        queueMicrotask(() => {
            const queue = db.queues.get(guildId);
            if (!queue) return;

            /**
             * Получаем текущее состояние нашего бота.
             */
            const botState = client.cache.voiceStates?.get(client.botId, guildId);

            /**
             * Если бот уже не находится в голосовом канале —
             * ничего делать не нужно.
             */
            if (!botState?.channelId) return;

            /**
             * Проверяем, есть ли хотя бы один человек
             * в том же канале, где находится бот.
             */
            let hasHumans = false;

            for (const state of client.cache.voiceStates?.values(guildId) ?? []) {
                if (state.channelId !== botState.channelId)
                    continue;

                if (state.userId === client.botId)
                    continue;

                const member = client.cache.members?.get(state.userId, guildId);

                if (member && !member.user?.bot) {
                    hasHumans = true;
                    break;
                }
            }

            /**
             * ======================================================
             * В КАНАЛЕ ЕСТЬ ЛЮДИ
             * ======================================================
             */
            if (hasHumans) {
                clearLeaveTimer(guildId);

                if (queue.player?.status === "player/pause")
                    queue.player.resume();

                return;
            }

            /**
             * ======================================================
             * В КАНАЛЕ НЕТ ЛЮДЕЙ
             * ======================================================
             */

            if (timers.has(guildId))
                return;

            if (queue.player?.status === "player/playing")
                queue.player.pause();

            const timer = setTimeout(() => {
                timers.delete(guildId);

                /**
                 * Повторная проверка перед отключением.
                 * За это время кто-то мог зайти.
                 */
                const currentBot = client.cache.voiceStates?.get(client.botId, guildId);

                if (!currentBot?.channelId)
                    return;

                let hasHumans = false;

                for (const state of client.cache.voiceStates?.values(guildId) ?? []) {
                    if (state.channelId !== currentBot.channelId)
                        continue;

                    if (state.userId === client.botId)
                        continue;

                    const member = client.cache.members?.get(state.userId, guildId);

                    if (member && !member.user?.bot) {
                        hasHumans = true;
                        break;
                    }
                }

                if (hasHumans)
                    return;

                db.queues.remove(guildId);
                db.voice.remove(guildId);

            }, TIMEOUT * 1000);

            timers.set(guildId, timer);
        });
    }
});