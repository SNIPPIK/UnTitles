import { createEvent } from "seyfert";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Временная база данных для таймеров автоматического выхода
 */
const temple_db = new Map<string, NodeJS.Timeout>();

/**
 * @author SNIPPIK
 * @description Время (в секундах) до отключения бота, если в канале никого нет
 */
const timeout = 60;

export default createEvent({
    data: { name: "voiceStateUpdate" },
    run: ([newState, oldState], client) => {
        // Seyfert предоставляет newState и oldState. Используем текущее состояние для логики.
        const payload = newState ?? oldState;
        if (!payload) return;

        const { guildId, userId, channelId } = payload;

        // Обновляем адаптер базы данных (необходимо для работы голосового движка)
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
         * Используем queueMicrotask, чтобы логика проверки не блокировала
         * основной поток обработки событий Gateway.
         */
        queueMicrotask(async () => {
            // Получаем состояние бота на этом сервере
            const botState = await client.cache.voiceStates?.get(client.me.id, guildId);

            // Если бота нет в ГС — чистим таймеры и выходим
            if (!botState?.channelId) {
                const temp = temple_db.get(guildId);
                if (temp) {
                    clearTimeout(temp);
                    temple_db.delete(guildId);
                }

                const queue = db.queues.get(guildId);
                if (queue) {
                    db.queues.remove(guildId);
                    db.voice.remove(guildId);
                }
                return;
            }

            // Получаем ВСЕ стейты участников на сервере
            const guildStates = await client.cache.voiceStates?.values(guildId) ?? [];

            // Считаем живых людей в канале с ботом
            let humanCount = 0;
            for (const vs of guildStates) {
                if (vs.channelId === botState.channelId && vs.userId !== client.me.id) {
                    const member = await client.cache.members?.get(vs.userId, guildId);
                    if (member && !member.user.bot) humanCount++;
                }
            }

            const queue = db.queues.get(guildId);
            const temp = temple_db.get(guildId);

            // Если нет очереди, просто выходим
            if (!queue) return;

            // ЛОГИКА ПАУЗЫ / ВЫХОДА
            if (humanCount > 0) {
                // Есть люди: отменяем таймер удаления
                if (temp) {
                    clearTimeout(temp);
                    temple_db.delete(guildId);

                    // Возобновляем плеер, если он был на паузе
                    if (queue.player?.status === "player/pause") {
                        queue.player.resume();
                    }
                }
            } else {
                // Пропускаем событие, если это сам бот заходит
                const isSelfJoin = userId === client.me.id && !!channelId;
                if (isSelfJoin) return;

                // Если таймера нет — создаём
                if (!temp) {
                    if (queue.player?.status === "player/playing") {
                        queue.player.pause();
                    }

                    const timer = setTimeout(async () => {
                        // Финальная проверка перед удалением
                        const finalStates = await client.cache.voiceStates?.values(guildId) ?? [];
                        const finalBot = await client.cache.voiceStates?.get(client.me.id, guildId);

                        const stillAlone = !finalStates.some(vs =>
                            vs.channelId === finalBot?.channelId &&
                            vs.userId !== client.me.id &&
                            client.cache.members?.get(vs.userId, guildId).bot
                        );

                        if (stillAlone) {
                            db.queues.remove(guildId);
                            db.voice.remove(guildId);
                            temple_db.delete(guildId);
                            // Можно: await client.voice.leave(guildId);
                        }
                    }, timeout * 1000);

                    temple_db.set(guildId, timer);
                }
            }
        });
    }
});