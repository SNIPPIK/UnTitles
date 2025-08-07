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
         * @description Время последней смены времени цикла
         * @private
         */
        private _stepTimestamp: number = 0;

        /**
         * @description Переключатель Jitter Buffer'а
         * @private
         */
        private _switched: boolean = false;

        /**
         * @description Таймер перехода Jitter Buffer
         * @private
         */
        private timer: NodeJS.Timeout;

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
                    step: async () => {
                        const time = this.time - this.insideTime;

                        // Если цикл уходит от оригинала, подстраиваем плееры
                        if (time > OPUS_FRAME_SIZE) {
                            const frames = (Math.ceil(time / OPUS_FRAME_SIZE) + 1) * OPUS_FRAME_SIZE;

                            // Если текущее не совпадает с новым
                            if (this.options.duration < frames) {
                                // Устанавливаем время шага для поддержания
                                this._stepTimestamp = Date.now() + 700;

                                // Меняем время цикла
                                this.options.duration = frames;

                                // Если есть активный таймер
                                if (this.timer) clearTimeout(this.timer);
                            }
                        }

                        // Сброс таймера (Jitter buffer)
                        else if (this.options.duration !== OPUS_FRAME_SIZE && !this._switched) {
                            // Защищаемся от спама
                            if (this._stepTimestamp < Date.now()) {
                                this._switched = true;

                                // Если есть активный таймер
                                if (this.timer) clearTimeout(this.timer);

                                // Задаем таймер
                                this.timer = setTimeout(() => {
                                    this._switched = false;
                                    this.options.duration = OPUS_FRAME_SIZE;
                                }, 1e3);
                            }
                        }
                    }
                },

                // Функция проверки
                filter: (item) => item.playing && item.voice.connection.ready,

                // Функция отправки аудио фрейма
                execute: (player) => {
                    const size = this.options.duration / OPUS_FRAME_SIZE;
                    let i = 0;

                    // Если цикл держит планку в 20 ms
                    if (size === 1) {
                        // Отправляем 1 пакет заранее, для заполнения кольцевого буфера
                        if (player.audio && player.audio.current.duration === 0) {
                            i = -1;
                        }
                    }

                    // Отправляем пакет/ы в голосовой канал
                    do {
                        try {
                            player.voice.connection.packet = player.audio.current.packet;
                        } catch (err) {}
                        i++;
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