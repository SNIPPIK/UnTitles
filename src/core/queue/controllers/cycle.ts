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

            // Функция отправки аудио фрейма
            execute: (player) => {
                const audio = player.audio.current;
                const connection = player.voice.connection;
                const sendCount = Math.max(
                    ((this.options.duration / OPUS_FRAME_SIZE) + PLAYER_SEND_POOL) - (connection.udp.packets ?? 0),
                    0
                );

                let actuallySent = 0;
                let packet: Buffer;

                // Если есть пакеты к отправлению
                if (sendCount) {
                    // Развёрнутый цикл для микро-оптимизации (если очень много пакетов)
                    while (actuallySent < sendCount) {
                        if (!(packet = audio.packet)) break;
                        connection.packet(packet);
                        actuallySent++;
                    }
                }

                if (!packet && audio.packets === 0 && !connection.udp.packets) {
                    player.status = AudioPlayerState.idle;
                    player.cycle = false;
                }

                player._buffered = actuallySent;
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
 * @description Циклическая система сообщений, используется для сообщения о текущем треке
 * @class Messages
 * @extends TaskCycle
 * @private
 */
class Messages<T extends CycleInteraction> extends TaskCycle<T> {
    /**
     * @description Запускаем циклическую систему сообщений
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Время до следующего прогона цикла
            duration: MESSAGE_UPDATE_TIME,

            // Кастомные функции (если хочется немного изменить логику выполнения)
            custom: {
                remove: async (item) => {
                    try {
                        if (!!item.delete) await item.delete();
                    } catch {
                        Logger.log("ERROR", `Failed delete message in cycle!`);
                    }
                },
                push: (item) => {
                    const old = this.find(msg => msg.guildId === item.guildId);
                    if (old) this.delete(old);
                }
            },

            // Функция проверки
            filter: (message) => !!message.edit && message.createdTimestamp + MESSAGE_COOLDOWN_TIME < Date.now() || message.timestamp + MESSAGE_COOLDOWN_TIME < Date.now(),

            // Функция обновления сообщения
            execute: (message) => {
                const queue = db.queues.get(message.guildId);

                // Если нет очереди
                if (!queue) this.delete(message);
                const component = queue.components;

                // Если не получен embed
                if (!component) {
                    this.delete(message);
                    return;
                }

                return this.update(message, component);
            }
        });
    };

    /**
     * @description Обновление сообщения принудительно
     * @param message - Сообщение
     * @param component - Данные для обновления
     * @returns Promise<void>
     * @public
     */
    public update = (message: T, component: MessageComponent) => {
        try {
            if (message.createdTimestamp) message.edit({ components: component, embeds: null }).catch(console.error);
        } catch (error) {
            Logger.log("ERROR", `Failed to edit message in cycle\n${error instanceof Error ? error.stack : error}`);

            // Если при обновлении произошла ошибка
            this.delete(message);
        }
    };

    /**
     * @description Гарантирует, что сообщение существует и не устарело
     * @returns Promise<T | null>
     * @public
     */
    public ensure = async (guildId: string, factory: () => Promise<T>): Promise<T | null> => {
        let message = this.find(m => m.guildId === guildId);

        // Если нет сообщения в цикле
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