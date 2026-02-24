import type { CycleInteraction, MessageComponent } from "#structures/discord";
import { OPUS_FRAME_SIZE } from "#core/audio";
import { AudioPlayer } from "#core/player";
import { TaskCycle } from "#native/cycle";
import { Logger } from "#structures";
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
 * @description Циклическая система плееров, используется для отправки аудио пакетов
 * @class AudioPlayers
 * @extends TaskCycle
 * @private
 */
class AudioPlayers<T extends AudioPlayer> extends TaskCycle<T> {
    /**
     * @description Запускаем циклическую систему плееров, весь логический функционал здесь
     * @constructor
     * @public
     */
    public constructor() {
        super({
            // Время до следующего прогона цикла
            duration: OPUS_FRAME_SIZE,

            // Функция проверки
            filter: (item) => item.playing,

            // Функция отправки аудио фрейма
            execute: (player) => {
                const audio = player.audio.current;
                const packet = audio.packet;

                if (packet) player.voice.connection.packet(packet);
                else {
                    // Если поток не читается, переходим в состояние ожидания
                    if (!audio || !audio.readable || audio.packets === 0) {
                        player.status = "player/wait";
                        player.cycle = false;
                    }
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
const MESSAGE_UPDATE_TIME = 1e3 * 10;

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
            filter: (message) => message.createdTimestamp + 5e3 < Date.now() && message.timestamp + 5e3 < Date.now(),

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
            factory()
                .then((m) => {
                    m.guildId = guildId;
                    this.add(m)
                })
                .catch(console.error);

            return null;
        }

        // Если время позволяет пересоздать сообщение о проигрывании
        else if (Date.now() - message.createdTimestamp > MESSAGE_RESEND_TIME) {
            this.delete(message);
            factory()
                .then((m) => {
                    m.guildId = guildId;
                    this.add(m)
                })
                .catch(console.error);

            return null;
        }

        return message;
    }
}