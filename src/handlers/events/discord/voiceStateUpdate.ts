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

                // Если в базе еще висит очередь — удаляем (бота выгнали)
                if (db.queues.get(guildId)) {
                    db.queues.remove(guildId);
                    db.voice.remove(guildId);
                }
                return;
            }

            // Получаем ВСЕ стейты участников на этом сервере
            const guildStates = await client.cache.voiceStates?.values(guildId) ?? [];

            // Считаем живых людей в канале с ботом
            let humanCount = 0;
            for (const vs of guildStates) {
                // Если человек в том же канале, что и бот, и это не сам бот
                if (vs.channelId === botState.channelId && vs.userId !== client.me.id) {
                    // Проверяем, не бот ли это (через кэш мемберов)
                    const member = await client.cache.members?.get(vs.userId, guildId);
                    if (member && !member.user.bot) {
                        humanCount++;
                    }
                }
            }

            const queue = db.queues.get(guildId);
            const temp = temple_db.get(guildId);

            if (!queue) return;

            // ЛОГИКА ПАУЗЫ / ВЫХОДА
            if (humanCount > 0) {
                // Кто-то есть: отменяем удаление
                if (temp) {
                    clearTimeout(temp);
                    temple_db.delete(guildId);
                    if (queue.player?.status === "player/pause") {
                        queue.player.resume();
                    }
                }
            } else {
                // Никого нет: запускаем таймер

                // Пропускаем, если событие вызвано самим ботом (вход в канал)
                const isSelfJoin = userId === client.me.id && !!channelId;
                if (isSelfJoin) return;

                if (!temp) {
                    // Ставим на паузу сразу
                    if (queue.player?.status === "player/playing") {
                        queue.player.pause();
                    }

                    const timer = setTimeout(async () => {
                        // Финальная проверка перед ливом
                        const finalStates = await client.cache.voiceStates?.values(guildId) ?? [];
                        const finalBot = await client.cache.voiceStates?.get(client.me.id, guildId);

                        const stillAlone = !finalStates.some(vs =>
                            vs.channelId === finalBot?.channelId &&
                            vs.userId !== client.me.id
                        );

                        if (stillAlone) {
                            db.queues.remove(guildId);
                            db.voice.remove(guildId);
                            // Можно добавить: await client.voice.leave(guildId);
                        }
                    }, timeout * 1000);

                    temple_db.set(guildId, timer);
                }
            }
        });
    }
});