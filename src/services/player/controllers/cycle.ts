import { CycleInteraction, Logger, SyncCycle } from "#structures";
import { OPUS_FRAME_SIZE } from "#service/voice";
import { AudioPlayer } from "#service/player";
import { env } from "#app/env";
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
     * @extends SyncCycle
     * @readonly
     * @public
     */
    public readonly players = new class AudioPlayers<T extends AudioPlayer> extends SyncCycle<T> {
        public constructor() {
            super({
                duration: OPUS_FRAME_SIZE * parseInt(env.get("player.preferred", "1")),
                filter: (item) => item.playing,
                execute: (player) => {
                    const connection = player.voice.connection;

                    // Отправляем пакет в голосовой канал
                    for (let i = 0; i < this.options.duration / OPUS_FRAME_SIZE; i++) {
                        connection.packet = player.audio.current.packet;
                    }
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @extends SyncCycle
     * @readonly
     * @public
     */
    public readonly messages = new class Messages<T extends CycleInteraction> extends SyncCycle<T> {
        public constructor() {
            super({
                duration: 20e3,
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
                filter: (message) => message["editable"],
                execute: async (message) => {
                    const queue = db.queues.get(message.guild.id);

                    // Если нет очереди
                    if (!queue) this.delete(message);

                    // Если есть поток в плеере
                    else if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                        const embed = queue.componentEmbed;

                        // Если не получен embed
                        if (!embed) {
                            this.delete(message);
                            return;
                        }

                        try {
                            await message.edit({embeds: [embed], components: queue.components});
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