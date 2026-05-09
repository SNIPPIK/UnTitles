import type { CycleInteraction, MessageComponent } from "#structures/discord/index.js";
import { AudioPlayer, AudioPlayerState } from "#core/player/index.js";
import { OPUS_FRAME_SIZE } from "#core/audio/index.js";
import { Logger, TaskCycle } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class ControllerCycles
 * @public
 */
export class ControllerCycles {
    /** Цикл для работы плеера, необходим для отправки пакетов */
    public players = new AudioPlayers();

    /** Цикл для обновления сообщений, необходим для красивого прогресс бара */
    public messages = new Messages();
}

/**
 * @author SNIPPIK
 * @description Время шага и время аудио пакетов для отправки в низкоуровневую систему
 * @const PLAYER_SEND_NATIVE
 * @private
 */
const PLAYER_SEND_NATIVE = Math.floor(OPUS_FRAME_SIZE * 5);

/**
 * @author SNIPPIK
 * @description Кол-во пакетов которые будет всегда в udp подключении в качестве буфера для гашения Event loop
 * @const PLAYER_SEND_POOL
 * @private
 */
const PLAYER_SEND_POOL = Math.floor((PLAYER_SEND_NATIVE / OPUS_FRAME_SIZE) * 5);

/**
 * @author SNIPPIK
 * @description Кол-во пакетов, которые могут быть в буфере UDP, если превысить лимит то, пакеты будут потеряны
 * @const PLAYER_SEND_LIMIT
 * @private
 */
const PLAYER_SEND_LIMIT = PLAYER_SEND_POOL * 3;

/**
 * @author SNIPPIK
 * @description Циклическая система плееров для плавной отправки аудиопакетов.
 * Адаптирует скорость работы цикла в зависимости от нагрузки Event Loop.
 *
 * @class AudioPlayers
 * @extends TaskCycle
 * @private
 */
class AudioPlayers<T extends AudioPlayer> extends TaskCycle<T> {
    // Храним время последней корректировки цикла (для предотвращения слишком частых изменений)
    private _lastAdjust = 0;

    // Используем WeakMap для безопасного хранения состояний (метрик) каждого плеера.
    // Это избавляет нас от необходимости принудительно писать данные в сам объект плеера через `any`.
    private _playerMetrics = new WeakMap<T, { starving: boolean; buffered: number }>();

    /**
     * @description Инициализирует цикл обработки аудио-плееров
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Базовое время до следующего прогона цикла
            duration: PLAYER_SEND_NATIVE,

            // Кастомные функции для управления циклом
            custom: {
                step: () => {
                    let anyStarving = false;
                    let anyOverloaded = false;
                    let activePlayers = 0;

                    // Проходимся по всем плеерам в текущем цикле
                    for (const p of this) {
                        // Если плеер не проходит фильтр (например, не играет) — пропускаем его
                        if (!this.options.filter(p)) continue;

                        activePlayers++;

                        // Получаем или создаем метрики для текущего плеера
                        const metrics = this._getOrCreateMetrics(p);

                        // Проверяем статус "голодания" (не хватает пакетов для отправки)
                        if (metrics.starving) {
                            anyStarving = true;
                        }

                        // Проверяем статус "перегрузки" (буфер UDP забит более чем на 80%)
                        const packets = p.voice?.connection?.udp?.packets ?? 0;
                        if (packets > PLAYER_SEND_LIMIT * 0.8) {
                            anyOverloaded = true;
                        }

                        // Сбрасываем флаг голодания для следующего шага цикла
                        metrics.starving = false;
                    }

                    // --- Адаптация скорости цикла ---
                    // Если есть активные плееры, решаем, нужно ли нам ускорить или замедлить цикл
                    if (activePlayers > 0) {
                        if (anyStarving) {
                            // Если кому-то не хватает пакетов, замедляем цикл (увеличиваем интервал),
                            // чтобы дать системе время накопить аудиоданные.
                            this.options.duration = Math.min(
                                PLAYER_SEND_NATIVE * 2,
                                this.options.duration + OPUS_FRAME_SIZE
                            );
                        } else if (anyOverloaded) {
                            // Если буфер переполнен, ускоряем цикл (уменьшаем интервал),
                            // чтобы быстрее разгрести очередь пакетов.
                            this.options.duration = Math.max(
                                PLAYER_SEND_NATIVE / 2,
                                this.options.duration - OPUS_FRAME_SIZE
                            );
                        } else {
                            // Если всё в порядке, плавно возвращаемся к стандартной скорости (базовому интервалу)
                            if (this.options.duration > PLAYER_SEND_NATIVE) {
                                this.options.duration = Math.max(PLAYER_SEND_NATIVE, this.options.duration - OPUS_FRAME_SIZE);
                            } else if (this.options.duration < PLAYER_SEND_NATIVE) {
                                this.options.duration = Math.min(PLAYER_SEND_NATIVE, this.options.duration + OPUS_FRAME_SIZE);
                            }
                        }
                    }

                    // --- Коррекция времени (компенсация микро-задержек процессора) ---
                    const now = this.time;
                    const drift = Math.abs(now - this.insideTime);

                    // Вычисляем, насколько кадров мы сдвинулись
                    const frames = drift > PLAYER_SEND_NATIVE ? drift + PLAYER_SEND_NATIVE : PLAYER_SEND_NATIVE;
                    const quantized = Math.max(PLAYER_SEND_NATIVE, Math.ceil(frames / OPUS_FRAME_SIZE) * OPUS_FRAME_SIZE);

                    // Применяем корректировку только раз в определенное время (Cooldown)
                    if ((now - this._lastAdjust >= PLAYER_SEND_NATIVE) && (this.options.duration !== quantized)) {
                        const step = this.options.duration > quantized ? -OPUS_FRAME_SIZE : OPUS_FRAME_SIZE;
                        this.options.duration = Math.max(PLAYER_SEND_NATIVE, Math.min(this.options.duration + step, quantized));

                        // Устанавливаем задержку до следующей корректировки
                        this._lastAdjust = now + PLAYER_SEND_NATIVE * 5;
                    }
                }
            },

            // Оставляем в цикле только те плееры, которые сейчас проигрывают аудио и готовы к работе
            filter: (item) => item.playing && item.voice?.connection?.ready,

            /**
             * @description Выполняет отправку аудиопакетов из буфера в UDP-соединение для одного плеера.
             * @param player - Экземпляр аудио плеера
             * @public
             */
            execute: (player) => {
                const connection = player.voice.connection;
                const metrics = this._getOrCreateMetrics(player);

                // Защита от переполнения: если пакетов уже слишком много, ничего не отправляем
                if (connection.udp.packets > PLAYER_SEND_LIMIT) return;

                // Считаем базовое количество пакетов, которые нужно отправить за текущий шаг
                let toSend = Math.ceil(this.options.duration / OPUS_FRAME_SIZE);

                // Добавляем запас пакетов, если буфер соединения почти пуст (предотвращает заикания)
                if (connection.udp.packets <= PLAYER_SEND_POOL) {
                    toSend += PLAYER_SEND_POOL;
                }

                // Рассчитываем, сколько максимум мы можем безопасно добавить
                const maxAllowedTotal = toSend + PLAYER_SEND_POOL;
                let allowed = Math.max(0, maxAllowedTotal - connection.udp.packets);

                const audio = player.audio.current;

                // Сбрасываем метрику буферизации перед новой попыткой
                metrics.buffered = 0;

                // Берем пакеты из источника аудио и отправляем их в соединение
                if (allowed > 0) {
                    const batch = audio.packetAt(allowed + 2); // Запрашиваем с небольшим запасом
                    if (batch && batch.length > 0) {
                        connection.packet(batch);
                        metrics.buffered = batch.length; // Сохраняем информацию о том, сколько реально взяли
                    }
                }

                // --- Проверка на "голодание" источника ---
                // Если мы хотели взять пакеты (allowed > 0), но источник ничего не дал (buffered === 0)
                // ИЛИ если мы запросили много, а получили меньше половины — плеер не справляется (голодает).
                metrics.starving = (allowed > 0 && metrics.buffered === 0) ||
                    (allowed > 2 && metrics.buffered < allowed / 2);

                // Если и в источнике, и в буфере UDP закончились пакеты — останавливаем плеер
                if (audio.packets === 0 && connection.udp.packets === 0) {
                    player.status = AudioPlayerState.idle;
                    player.cycle = false;
                    metrics.starving = false;
                }
            }
        });
    }

    /**
     * @description Вспомогательный метод для безопасного получения метрик плеера
     * @private
     */
    private _getOrCreateMetrics(player: T) {
        let metrics = this._playerMetrics.get(player);
        if (!metrics) {
            metrics = { starving: false, buffered: 0 };
            this._playerMetrics.set(player, metrics);
        }
        return metrics;
    }

    /**
     * @description Очистка цикла и принудительный запуск сборщика мусора (Garbage Collector)
     * @returns void
     * @public
     */
    public reset = (): void => {
        // Оборачиваем вызов GC в проверку, чтобы избежать падения программы,
        // если скрипт запущен без флага --expose-gc
        setImmediate(() => {
            if (typeof global !== "undefined" && typeof global.gc === "function") {
                Logger.log("DEBUG", "[Node] running Garbage Collector - running in player cycle");
                global.gc();
            } else {
                Logger.log("DEBUG", "[Node] Garbage Collector is not exposed. Skipping.");
            }
        });

        // Сбрасываем кэш метрик для надежности
        this._playerMetrics = new WeakMap();
        super.reset();
    };
}



/**
 * @author SNIPPIK
 * @description Время через которое будет создано новое сообщение
 * @const MESSAGE_RESEND_TIME
 * @private
 */
const MESSAGE_RESEND_TIME = 60e3 * 5;

/**
 * @author SNIPPIK
 * @description Время через которое можно обновлять сообщение
 * @const MESSAGE_UPDATE_TIME
 * @private
 */
const MESSAGE_UPDATE_TIME = 1e3 * 10;

/**
 * @author SNIPPIK
 * @description Время через которое можно обновлять сообщение
 * @const MESSAGE_COOLDOWN_TIME
 * @private
 */
const MESSAGE_COOLDOWN_TIME = 5e3;

/**
 * @author SNIPPIK
 * @description Менеджер циклического обновления сообщений в голосовых каналах.
 *              Отвечает за автоматическое обновление now-playing embed'ов и компонентов,
 *              удаление устаревших сообщений, пересоздание при необходимости.
 *
 * @template T - Тип сообщения, должен расширять `CycleInteraction` (иметь `guildId`, `edit`, `delete`).
 *
 * @remarks
 * - Использует родительский класс `TaskCycle<T>`, который обеспечивает циклический вызов `execute`.
 * - В конструкторе настраиваются параметры цикла: интервал обновления, кастомные обработчики,
 *   фильтр и основная логика обновления.
 * - Каждый гильдии соответствует только одно активное сообщение (проверка по `guildId`).
 * - Сообщения автоматически удаляются, если очередь музыки исчезла или компоненты отсутствуют.
 *
 * @example
 * ```ts
 * const messages = new Messages();
 * const msg = await messages.ensure(guildId, () => channel.send({ embeds: [embed] }));
 * if (msg) messages.update(msg, newComponents);
 * ```
 */
class Messages<T extends CycleInteraction> extends TaskCycle<T> {
    /**
     * @description Создаёт экземпляр менеджера сообщений и настраивает цикл обновления.
     *
     * @remarks
     * Параметры цикла:
     * - `duration` – интервал между вызовами `execute` (миллисекунды).
     * - `custom.remove` – обработчик удаления сообщения: вызывает `delete()`, если метод существует.
     * - `custom.push` – при добавлении нового сообщения удаляет старое для той же гильдии (гарантирует уникальность).
     * - `filter` – проверяет, можно ли обновлять сообщение (наличие метода `edit` и не истёк ли `cooldown`).
     * - `execute` – основная логика: получает очередь из БД, извлекает компоненты, вызывает `update`.
     *
     * @public
     */
    public constructor() {
        super({
            // Интервал обновления сообщений (миллисекунды)
            duration: MESSAGE_UPDATE_TIME,

            // Кастомные обработчики жизненного цикла
            custom: {
                /**
                 * Удаляет сообщение, если у него есть метод `delete`.
                 * Вызывается при выходе сообщения из цикла.
                 */
                remove: async (item) => {
                    try {
                        if (!!item.delete) await item.delete();
                    } catch {
                        Logger.log("ERROR", `Failed delete message in cycle!`);
                    }
                },
                /**
                 * При добавлении нового сообщения удаляет старое для той же гильдии,
                 * чтобы в системе всегда было только одно активное сообщение на гильдию.
                 */
                push: async (item) => {
                    const old = this.find(msg => msg.guildId === item.guildId);
                    if (old) {
                        try {
                            if (!!old.delete) await old.delete();
                        } catch {
                            Logger.log("ERROR", `Failed delete message in cycle!`);
                        }
                    }
                }
            },

            /**
             * Фильтр, определяющий, нужно ли обновлять сообщение.
             * Условия:
             * 1. У сообщения есть метод `edit` (возможность редактирования).
             * 2. Сообщение существует дольше, чем `MESSAGE_COOLDOWN_TIME`,
             *    либо прошло достаточно времени с момента создания.
             */
            filter: (message) => !!message.edit && message.createdTimestamp + MESSAGE_COOLDOWN_TIME < Date.now() || message.createdTimestamp + MESSAGE_COOLDOWN_TIME < Date.now(),

            /**
             * Основная функция обновления, вызываемая циклически.
             * - Получает очередь музыки по `guildId`.
             * - Если очереди нет – удаляет сообщение.
             * - Если есть компоненты (кнопки) – вызывает `update`.
             * - Если компонентов нет – удаляет сообщение.
             */
            execute: (message) => {
                const queue = db.queues.get(message.guildId);

                // Нет очереди – сообщение больше не нужно
                if (!queue) {
                    this.delete(message);
                    return;
                }
                const component = queue.components;

                // Нет компонентов для обновления – сообщение бесполезно
                if (!component) {
                    this.delete(message);
                    return;
                }

                return this.update(message, component);
            }
        });
    };

    /**
     * @description Принудительно обновляет сообщение, используя переданные компоненты.
     *              В случае ошибки (например, сообщение удалено) удаляет сообщение из цикла.
     *
     * @param message - Объект сообщения, которое нужно обновить.
     * @param component - Новые компоненты (кнопки) для встраивания.
     *
     * @remarks
     * - Редактирование происходит только если у сообщения есть поле `createdTimestamp`
     *   (т.е. оно действительно существует и было создано).
     * - Ошибки перехватываются и логируются, после чего сообщение удаляется из цикла.
     *
     * @public
     */
    public update = (message: T, component: MessageComponent) => {
        try {
            if (message.createdTimestamp) message.edit({ components: component, embeds: null }).catch(console.error);
        } catch (error) {
            Logger.log("ERROR", `Failed to edit message in cycle\n${error instanceof Error ? error.stack : error}`);

            // Если при обновлении произошла ошибка, удаляем сообщение из цикла
            this.delete(message);
        }
    };

    /**
     * @description Гарантирует существование актуального сообщения для гильдии.
     *              Если сообщения нет или оно устарело (старше `MESSAGE_RESEND_TIME`),
     *              создаётся новое с помощью фабричной функции.
     *
     * @param guildId - ID гильдии, для которой нужно сообщение.
     * @param factory - Функция, создающая новое сообщение (обычно отправляет embed).
     *
     * @returns Актуальное сообщение (если оно уже есть и не устарело), иначе `null`.
     *          После создания нового сообщения возвращается `null`, так как оно ещё не попало в цикл.
     *
     * @remarks
     * - Используется при старте воспроизведения или при необходимости пересоздать embed.
     * - Если сообщение существует, но старше `MESSAGE_RESEND_TIME`, оно удаляется и создаётся новое.
     * - В случае ошибки создания (например, канал удалён) ошибка логируется, возвращается `null`.
     *
     * @public
     */
    public ensure = async (guildId: string, factory: () => Promise<T>): Promise<T | null> => {
        let message = this.find(m => m.guildId === guildId);

        // Сообщения в цикле нет – создаём новое
        if (!message) {
            try {
                const msg = await factory();
                msg.guildId = guildId;
                this.add(msg);
            } catch (err) {
                Logger.log("ERROR", err as Error);
            }

            return null;
        }

        // Если время позволяет пересоздать сообщение о проигрывании
        else if (Date.now() - message.createdTimestamp > MESSAGE_RESEND_TIME) {
            this.delete(message);
            try {
                const msg = await factory();
                msg.guildId = guildId;
                this.add(msg);
            } catch (err) {
                Logger.log("ERROR", err as Error);
            }

            return null;
        }

        return message;
    }
}