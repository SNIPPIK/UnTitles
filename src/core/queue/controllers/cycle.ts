import { CycleInteraction } from "#structures/discord";
import { Logger, TaskCycle } from "#structures";
import { OPUS_FRAME_SIZE } from "#core/audio";
import { AudioPlayer } from "#core/player";
import { db } from "#app/db";

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
                        const time = this.time - this.insideTime;

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
                        const now = this.time;
                        if (now - this._lastAdjust >= OPUS_FRAME_SIZE) {
                            // Если текущее время меньше указанного
                            if (this.options.duration < this._targetDuration)
                                this.options.duration = Math.min(this.options.duration + OPUS_FRAME_SIZE, this._targetDuration);

                            // Если текущее время меньше указанного
                            else if (this.options.duration > this._targetDuration)
                                this.options.duration = Math.max(this.options.duration - OPUS_FRAME_SIZE, this._targetDuration);

                            this._lastAdjust = now;

                            // Для отладки
                            //console.log(`[step] duration adjusted to ${this.options.duration} ms, target: ${this._targetDuration} ms | ${this.delay}\n\nTime: ${this.insideTime} - ${this.time} | ${this.drifting}`);
                        }
                    }
                },

                // Функция проверки
                filter: (item) => item.playing && item.voice.connection.ready,

                // Функция отправки аудио фрейма
                execute: (player) => {
                    const size = this.options.duration / OPUS_FRAME_SIZE;
                    let i = 0;

                    /*
                    // Если цикл держит планку в 20 ms
                    if (size === 1) {
                        // Отправляем 1 пакет заранее, для заполнения кольцевого буфера
                        if (player.audio && !player._sendPrepareJitter) {
                            player._sendPrepareJitter = true;

                            // Проверяем можно ли отправить пакеты
                            i = player.audio.current.packets >= 2 ? -1 : 0;
                        }
                    }

                     */

                    // Отправляем пакет/ы в голосовой канал
                    do {
                        i++;
                        player.voice.connection.packet = player.audio.current.packet;
                    } while (i < size);
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
                duration: 20e3,
                drift: true,
                // Кастомные функции (если хочется немного изменить логику выполнения)
                custom: {
                    remove: async (item) => {
                        try {
                            await item.delete();
                        } catch {
                            Logger.log("ERROR", `Failed delete message in cycle!`);
                        }
                    },
                    push: (item) => {
                        const old = this.find(msg => msg.guildId === item.guildId);
                        // Удаляем прошлое сообщение
                        if (old) this.delete(old);
                    }
                },

                // Функция проверки
                filter: (message) => !!message.edit && message.createdTimestamp + 10e3 < Date.now(),

                // Функция обновления сообщения
                execute: async (message) => {
                    const queue = db.queues.get(message.guildId);

                    // Если нет очереди
                    if (!queue) this.delete(message);

                    // Если есть поток в плеере
                    else if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                        const component = queue.components;

                        // Если не получен embed
                        if (!component) {
                            this.delete(message);
                            return;
                        }

                        try {
                            await message.edit({ components: component });
                        } catch (error) {
                            Logger.log("ERROR", `Failed to edit message in cycle: ${error instanceof Error ? error.message : error}`);

                            // Если при обновлении произошла ошибка
                            this.delete(message);
                        }
                    }
                }
            });
        };
    };
}