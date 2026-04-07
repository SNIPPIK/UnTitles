import type { CycleInteraction, MessageComponent } from "#structures/discord";
import { AudioPlayer, AudioPlayerState } from "#core/player";
import { Logger, TaskCycle } from "#structures";
import { OPUS_FRAME_SIZE } from "#core/audio";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class ControllerCycles
 * @public
 */
export class ControllerCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
     * @public
     */
    public players = new AudioPlayers();

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @public
     */
    public messages = new Messages();
}

/**
 * @author SNIPPIK
 * @description Время шага и время аудио пакетов для отправки в низкоуровневую систему
 * @const PLAYER_SEND_NATIVE
 * @private
 */
const PLAYER_SEND_NATIVE = Math.floor(OPUS_FRAME_SIZE * 10);

/**
 * @author SNIPPIK
 * @description Кол-во пакетов которые будет всегда в udp подключении в качестве буфера для гашения Event loop
 * @const PLAYER_SEND_POOL
 * @private
 */
const PLAYER_SEND_POOL = Math.floor((PLAYER_SEND_NATIVE / OPUS_FRAME_SIZE) * 3);

/**
 * @author SNIPPIK
 * @description Циклическая система плееров, используется для отправки аудио пакетов
 * @class AudioPlayers
 * @extends TaskCycle
 * @private
 */
class AudioPlayers<T extends AudioPlayer> extends TaskCycle<T> {
    private _lastAdjust = 0;

    /**
     * @description Запускаем циклическую систему плееров, весь логический функционал здесь
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Время до следующего прогона цикла
            duration: PLAYER_SEND_NATIVE,

            // Кастомные функции (если хочется немного изменить логику выполнения)
            custom: {
                step: () => {
                    const now = this.time;
                    const drift = Math.abs(now - this.insideTime);
                    const frames = drift > PLAYER_SEND_NATIVE ? drift + PLAYER_SEND_NATIVE : PLAYER_SEND_NATIVE;
                    const quantized = Math.max(PLAYER_SEND_NATIVE, Math.ceil(frames / OPUS_FRAME_SIZE) * OPUS_FRAME_SIZE);

                    // Коррекция только если нужно и время пришло
                    if ((now - this._lastAdjust >= PLAYER_SEND_NATIVE) && (this.options.duration !== quantized)) {
                        const step = this.options.duration > quantized ? -OPUS_FRAME_SIZE : OPUS_FRAME_SIZE;
                        this.options.duration = Math.max(PLAYER_SEND_NATIVE, Math.min(this.options.duration + step, quantized));
                        this._lastAdjust = now;
                    }
                }
            },

            // Функция проверки
            filter: (item) => item.playing && item.voice?.connection?.ready,

            /**
             * @author SNIPPIK
             * @description Выполняет отправку аудиопакетов из буфера в UDP-соединение.
             *              Пакеты извлекаются из очереди аудиоданных и передаются в сокет.
             *              Если пакетов нет и очереди пусты, плеер переводится в состояние idle.
             *
             * @param player - Экземпляр аудиоплеера, содержащий буфер аудиоданных и UDP-соединение.
             *
             * @remarks
             * - Количество пакетов для отправки рассчитывается как `длительность фрейма / размер фрейма` + запас.
             * - Запас (PLAYER_SEND_POOL) позволяет поддерживать буфер в соединении заполненным,
             *   предотвращая микро-заикания.
             * - Если пакетов в очереди аудиоданных нет и буфер соединения пуст, плеер переходит в idle.
             *
             * @public
             */
            execute: (player) => {
                const audio = player.audio.current;
                const connection = player.voice.connection;

                // Текущая задержка шага
                let toSend = Math.ceil(this.options.duration / OPUS_FRAME_SIZE);

                // Добавляем буфер
                if (audio.packets > 0 && connection.udp.packets <= PLAYER_SEND_POOL) {
                    toSend += PLAYER_SEND_POOL;
                }

                // Если есть что отправлять
                if (toSend <= 0) {
                    if (audio.packets === 0 && connection.udp.packets === 0) {
                        player.status = AudioPlayerState.idle;
                        player.cycle = false;
                    }
                    return;
                }

                const batch = audio.packetAt(toSend);

                if (batch.length > 0) connection.packet(batch);
                player._buffered = batch.length;

                if (audio.packets === 0 && connection.udp.packets === 0) {
                    player.status = AudioPlayerState.idle;
                    player.cycle = false;
                }
            }
        });
    };

    /**
     * @description Чистка цикла от всего + выполнение gc
     * @returns void
     * @public
     */
    public reset = () => {
        // Запускаем Garbage Collector
        setImmediate(() => {
            if (typeof global.gc === "function") {
                Logger.log("DEBUG", "[Node] running Garbage Collector - running in player cycle");
                global.gc();
            }
        });

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
 * ```typescript
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
                push: (item) => {
                    const old = this.find(msg => msg.guildId === item.guildId);
                    if (old) this.delete(old);
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
             * - Если есть компоненты (кнопки, селекты) – вызывает `update`.
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
     * @param component - Новые компоненты (кнопки, селекты) для встраивания.
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

        // Случай 1: сообщения в цикле нет – создаём новое
        if (!message) {
            try {
                const msg = await factory();
                msg.guildId = guildId;
                this.add(msg);
            } catch (err) {
                console.error(`TIMEOUT1: ${err}`)
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
                console.error(`TIMEOUT2: ${err}`)
            }

            return null;
        }

        return message;
    }
}