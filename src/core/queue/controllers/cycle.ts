import type { CycleInteraction, MessageComponent } from "#structures/discord";
import { Logger, TaskCycle } from "#structures";
import { OPUS_FRAME_SIZE } from "#core/audio";
import { AudioPlayer } from "#core/player";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Время через которое будет создано новое сообщение
 * @const MESSAGE_RESEND_TIME
 * @private
 */
const MESSAGE_RESEND_TIME = 60e3 * 10;

/**
 * @author SNIPPIK
 * @description Время через которое можно обновлять сообщение
 * @const MESSAGE_UPDATE_TIME
 * @private
 */
const MESSAGE_UPDATE_TIME = 1e3 * 15;

/**
 * @author SNIPPIK
 * @description Время задержки, при превышении будет добавляться аудио пакет
 * @const PLAYER_LATENCY_SIZE
 * @private
 */
const PLAYER_LATENCY_SIZE = 75;

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class ControllerCycles
 * @private
 */
export class ControllerCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
     * @extends TaskCycle
     * @readonly
     * @public
     */
    public readonly players = new class AudioPlayers<T extends AudioPlayer> extends TaskCycle<T> {
        /**
         * @description Текущее время шага
         * @private
         */
        private _targetDuration = OPUS_FRAME_SIZE;

        /**
         * @description Последнее зафиксированное время
         * @private
         */
        private _lastAdjust = 0;

        /**
         * @description Запускаем циклическую систему плееров, весь логический функционал здесь
         * @constructor
         * @public
         */
        public constructor() {
            super({
                // Время до следующего прогона цикла
                duration: OPUS_FRAME_SIZE,
                drift: false,

                // Кастомные функции (если хочется немного изменить логику выполнения)
                custom: {
                    step: () => {
                        const now = this.time;
                        const time = now - this.insideTime;

                        // === 1. Определяем, нужно ли увеличить длительность шага ===
                        if (time > OPUS_FRAME_SIZE) {
                            const frames = (Math.ceil(time / OPUS_FRAME_SIZE) + 1) * OPUS_FRAME_SIZE;

                            // Если новое время фрейма больше текущего
                            if (frames > this._targetDuration) this._targetDuration = frames;
                        }

                        else if (this._targetDuration !== OPUS_FRAME_SIZE) {
                            // Возврат к базовому шагу 20ms
                            this._targetDuration = OPUS_FRAME_SIZE;
                        }

                        // === 2. Плавная коррекция options.duration с задержкой между изменениями ===

                        if (now - this._lastAdjust >= OPUS_FRAME_SIZE) {
                            // Если текущее время меньше указанного
                            if (this.options.duration < this._targetDuration) this.options.duration = Math.min(this.options.duration + OPUS_FRAME_SIZE, this._targetDuration);

                            // Если текущее время меньше указанного
                            else if (this.options.duration > this._targetDuration) this.options.duration = Math.max(this.options.duration - OPUS_FRAME_SIZE, this._targetDuration);
                            this._lastAdjust = now;
                        }

                        // Для отладки
                        //console.log(`[step] duration adjusted to ${this.options.duration} ms, target: ${this._targetDuration} ms\nTime: ${this.insideTime} - ${this.time} | ${this.drifting}\n`);
                    }
                },

                // Функция проверки
                filter: (item) => item.playing,

                // Функция отправки аудио фрейма
                execute: (player) => {
                    // latency - задержка соединения
                    const latency = player.voice.connection.latency > PLAYER_LATENCY_SIZE ? Math.ceil(player.voice.connection.latency / PLAYER_LATENCY_SIZE) - 1 : 0;

                    // Количество фреймов в текущей итерации
                    let size = this.options.duration / OPUS_FRAME_SIZE;

                    // Если есть задержка голосового подключения
                    if (latency > 0 && size <= latency) {
                        // Инкремент счётчика
                        player._counter++;

                        // Проверяем достижение порога
                        if (player._counter < player._stepCounter) return;

                        // Если достигли — выполняем шаг
                        player._counter = 0; // сбрасываем
                        size = player._stepCounter = latency + size;
                    } else player._stepCounter = size;

                    // Отправляем пакет/ы в голосовой канал
                    let i = 0;
                    do {
                        i++;
                        const frame = player.audio.current.packet;
                        if (frame) player.voice.connection.packet = frame;
                    } while (i < size);
                }
            });
        };

        /**
         * @description Чистка цикла от всего + выполнение gc
         * @returns void
         * @public
         */
        public reset = () => {
            super.reset();

            // Запускаем Garbage Collector
            setImmediate(() => {
                if (typeof global.gc === "function") {
                    Logger.log("DEBUG", "[Node] running Garbage Collector - running player cycle");
                    global.gc();
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @extends TaskCycle
     * @readonly
     * @public
     */
    public readonly messages = new class Messages<T extends CycleInteraction> extends TaskCycle<T> {
        /**
         * @description Запускаем циклическую систему сообщений
         * @constructor
         * @public
         */
        public constructor() {
            super({
                // Время до следующего прогона цикла
                duration: MESSAGE_UPDATE_TIME,
                drift: true,
                // Кастомные функции (если хочется немного изменить логику выполнения)
                custom: {
                    remove: async (item) => {
                        try { await item.delete(); } catch { Logger.log("ERROR", `Failed delete message in cycle!`); }
                    },
                    push: (item) => {
                        const old = this.find(msg => msg.guildId === item.guildId);
                        if (old) this.delete(old);
                    }
                },

                // Функция проверки
                filter: (message) => !!message.edit && message.editable && message.editedTimestamp + 5e3 < Date.now(),

                // Функция обновления сообщения
                execute: async (message) => {
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
        public update = async (message: T, component: MessageComponent) => {
            try {
                if (message.editable) await message.edit({ components: component });
            } catch (error) {
                Logger.log("ERROR", `Failed to edit message in cycle: ${error instanceof Error ? error.message : error}`);

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
                this.add(await factory());
                return null;
            }

            // Если время позволяет пересоздать сообщение о проигрывании
            else if (Date.now() - message.createdTimestamp > MESSAGE_RESEND_TIME) {
                this.delete(message);
                this.add(await factory());
                return null;
            }

            return message;
        }
    };
}