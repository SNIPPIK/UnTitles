import { CycleInteraction } from "#structures/discord";
import { Logger, TaskCycle } from "#structures";
import { db } from "#app/db";

// Low level
import { OPUS_FRAME_SIZE } from "#core/audio";
import { AudioPlayer } from "#core/player";

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
                        const time = Math.abs(this.time - this.insideTime);

                        // Если цикл уходит от оригинала, подстраиваем плееры
                        // 1 - Очень много
                        // 0.5 - То что надо
                        // 0.2 - 0.3 - Допустимо
                        if (time > 20) {
                            const frames = (Math.ceil(time / OPUS_FRAME_SIZE) + 1) * OPUS_FRAME_SIZE;

                            // Если текущее не совпадает с новым
                            if (frames !== this.options.duration) {
                                // Устанавливаем время шага для поддержания
                                this._stepTimestamp = Date.now() + 1e3;

                                // Меняем время цикла
                                this.options.duration = frames;

                                // Если есть активный таймер
                                if (this.timer) clearTimeout(this.timer);
                            }
                        }

                        // Сброс таймера
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
                        player.voice.connection.packet = player.audio.current.packet;
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
                        const old = this.find(msg => msg.guild.id === item.guild.id);
                        // Удаляем прошлое сообщение
                        if (old) this.delete(old);
                    }
                },

                // Функция проверки
                filter: (message) => message.editable && (message.editedTimestamp ?? message.createdTimestamp) + 10e3 < Date.now(),

                // Функция обновления сообщения
                execute: async (message) => {
                    const queue = db.queues.get(message.guild.id);

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
                            await message.edit({components: component});
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