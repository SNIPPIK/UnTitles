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

/**
 * Проверяет, есть ли в канале бота хотя бы один живой (не-бот) пользователь.
 *
 * ВАЖНО: дополнительно учитывает `freshState` — состояние из текущего события.
 * Кеш seyfert может обновляться ПОСЛЕ диспатча `voiceStateUpdate`, поэтому
 * зашедший человек в `client.cache.voiceStates` может ещё отсутствовать.
 * Без этого бот ложно решает «людей нет» и ставит плеер на паузу.
 *
 * @param freshState Состояние пользователя из события (newState), либо null.
 */
function isBotChannelOccupiedByHuman(client: any, guildId: string, botChannelId: string, freshState: any | null): boolean {
    // 1. Мгновенная проверка: если из события видно, что пользователь
    //    сейчас в канале бота и это не бот — он там есть, независимо от кеша.
    if (
        freshState &&
        freshState.userId !== client.botId &&
        freshState.channelId === botChannelId
    ) {
        const member = client.cache.members?.get(freshState.userId, guildId);
        // Если member ещё не в кеше — считаем человеком (безопасный дефолт:
        // лучше не поставить на паузу, чем поставить при живом человеке).
        if (!member || !member.user?.bot) return true;
    }

    // 2. Полный проход по кешу.
    for (const state of client.cache.voiceStates?.values(guildId) ?? []) {
        if (state.channelId !== botChannelId) continue;
        if (state.userId === client.botId) continue;

        const member = client.cache.members?.get(state.userId, guildId);
        if (member && !member.user?.bot) return true;
    }

    return false;
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

            // Наш бот покинул канал — сносим очередь целиком.
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

            // Где сейчас наш бот.
            const botState = client.cache.voiceStates?.get(client.botId, guildId);
            if (!botState?.channelId) return;

            // newState — актуальное состояние пользователя из события.
            // Передаём его в проверку, чтобы не зависеть от гонки с кешем.
            const freshState = newState ?? null;

            const hasHumans = isBotChannelOccupiedByHuman(
                client,
                guildId,
                botState.channelId,
                freshState
            );

            /**
             * ======================================================
             * В КАНАЛЕ ЕСТЬ ЛЮДИ
             * ======================================================
             */
            if (hasHumans) {
                clearLeaveTimer(guildId);

                if (queue.player?.status === "player/pause") {
                    queue.player.resume();
                }

                return;
            }

            /**
             * ======================================================
             * В КАНАЛЕ НЕТ ЛЮДЕЙ
             * ======================================================
             */
            if (timers.has(guildId)) return;

            if (queue.player?.status === "player/playing") {
                queue.player.pause();
            }

            const timer = setTimeout(() => {
                timers.delete(guildId);

                // Повторная проверка — за минуту кто-то мог зайти.
                const currentBot = client.cache.voiceStates?.get(client.botId, guildId);
                if (!currentBot?.channelId) return;

                // Здесь `freshState` не нужен: с момента установки таймера
                // прошло 60 секунд, кеш гарантированно актуален.
                if (
                    isBotChannelOccupiedByHuman(
                        client,
                        guildId,
                        currentBot.channelId,
                        null
                    )
                ) {
                    return;
                }

                db.queues.remove(guildId);
                db.voice.remove(guildId);
            }, TIMEOUT * 1000);

            timers.set(guildId, timer);
        });
    }
});