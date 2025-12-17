import type { CycleInteraction, MessageComponent } from "#structures/discord";
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
 * @description Раз в N ms пробуем уменьшить Jitter Buffer
 * @const PLAYER_INTERVAL
 * @private
 */
//const PLAYER_INTERVAL = 10e3;

/**
 * @author SNIPPIK
 * @description Время сброса Jitter Buffer
 * @const PLAYER_DELAY_COOLDOWN
 * @private
 */
//const PLAYER_DELAY_COOLDOWN = 10e3;

/**
 * @author SNIPPIK
 * @description Максимальный размер задержки Jitter Buffer
 * @const PLAYER_MAX_DELAY
 * @private
 */
//const PLAYER_MAX_DELAY = 1000;

/**
 * @author SNIPPIK
 * @description Время задержки, при превышении будет добавляться аудио пакет
 * @const PLAYER_LATENCY_SIZE
 * @private
 */
//const PLAYER_LATENCY_SIZE = 100;
const PLAYER_AVG_FRAMES = 10

/**
 * @author SNIPPIK
 * @description Циклическая система плееров, используется для отправки аудио пакетов
 * @class AudioPlayers
 * @extends TaskCycle
 * @private
 */
class AudioPlayers<T extends AudioPlayer> extends TaskCycle<T> {
    /**
     * @description Время последней успешной попытки уменьшения duration
     * @private
     */
    //private _lastDecrease = 0;

    /**
     * @description Время последнего неудачного уменьшения. Нужен для cooldown
     * @private
     */
    //private _lastDecreaseFailed = 0;

    private _avgFrames = [];
    private _lastBaseInsert = 0;
    private _lastAdjust = 0;
    private _targetDuration = 20;
    /**
     * @description Запускаем циклическую систему плееров, весь логический функционал здесь
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Время до следующего прогона цикла
            duration: OPUS_FRAME_SIZE,

            // Кастомные функции (если хочется немного изменить логику выполнения)
            custom: {
                step: () => {
                    const now = this.time;
                    const time = Math.abs(now - this.insideTime);

                    // === Рассчитываем новое значение ===
                    let frames = OPUS_FRAME_SIZE;

                    // только вверх по 20 ms
                    if (time > OPUS_FRAME_SIZE) frames = time + OPUS_FRAME_SIZE;

                    // === Контроль записи в массив ===
                    const canInsertBase = now - this._lastBaseInsert >= 1000; // прошло 1 сек?

                    // разрешено вставлять любое > 20
                    if (frames > OPUS_FRAME_SIZE) this._avgFrames.push(frames);
                    else if (frames <= OPUS_FRAME_SIZE && canInsertBase) {
                        // базовый 20 можно лишь раз в секунду
                        this._avgFrames.push(OPUS_FRAME_SIZE);
                        this._lastBaseInsert = now;
                    }

                    // ограничиваем размер массива
                    if (this._avgFrames.length > PLAYER_AVG_FRAMES) this._avgFrames.shift();

                    // === Среднее значение Jitter ===
                    const avg = this._avgFrames.reduce((a, b) => a + b, 0) / this._avgFrames.length;

                    // === Округление по шагу 20ms ===
                    let quantized = Math.ceil(avg / OPUS_FRAME_SIZE) * OPUS_FRAME_SIZE;
                    if (quantized < OPUS_FRAME_SIZE) quantized = OPUS_FRAME_SIZE;
                    this._targetDuration = quantized;

                    // === 5. Плавная коррекция duration ===
                    if (now - this._lastAdjust >= OPUS_FRAME_SIZE) {
                        if (this.options.duration < this._targetDuration) this.options.duration = Math.min(this.options.duration + OPUS_FRAME_SIZE, this._targetDuration);
                        else if (this.options.duration > this._targetDuration) this.options.duration = Math.max(this.options.duration - OPUS_FRAME_SIZE, this._targetDuration);

                        this._lastAdjust = now + 2000;
                    }
                }
            },

            // Функция проверки
            filter: (item) => item.playing,

            // Функция отправки аудио фрейма
            execute: (player) => {
                // latency - задержка соединения
                //const latency = player.voice.connection.latency > PLAYER_LATENCY_SIZE ? Math.ceil(player.voice.connection.latency / PLAYER_LATENCY_SIZE) - 1 : 0;

                // Количество фреймов в текущей итерации
                let size = this.options.duration / OPUS_FRAME_SIZE;

                // Если есть задержка голосового подключения
                /*if (latency > 0 && size <= latency) {
                    // Инкремент счётчика
                    player._counter++;

                    // Проверяем достижение порога
                    if (player._counter < player._stepCounter) return;

                    // Если достигли — выполняем шаг
                    player._counter = 0; // сбрасываем
                    size = latency + size;
                }*/

                // Отправляем пакет/ы в голосовой канал
                for (let i = 0; i < size; i++) {
                    player.voice.connection.packet = player.audio.current.packet;
                }

                // Указываем кол-во аудио пакетов
                player._stepCounter = size;
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
                Logger.log("DEBUG", "[Node] running Garbage Collector - running in player cycle");
                global.gc();
            }
        });
    };
}



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
                        if (item.deletable) await item.delete();
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
            filter: (message) => !!message.edit && message.editable && message.createdTimestamp + 5e3 < Date.now() && message.editedTimestamp + 5e3 < Date.now(),

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
            factory().then(this.add).catch(console.error);
            return null;
        }

        // Если время позволяет пересоздать сообщение о проигрывании
        else if (Date.now() - message.createdTimestamp > MESSAGE_RESEND_TIME) {
            this.delete(message);
            factory().then(this.add).catch(console.error);
            return null;
        }

        return message;
    }
}