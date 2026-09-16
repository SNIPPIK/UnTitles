import { Colors, CommandInteraction } from "#structures/discord/index.js";
import { CycleInteraction } from "#structures/discord/index.js";
import { ControllerCycles } from "./controllers/cycle.js";
import { Track } from "#core/queue/structures/track.js";
import { APIRequestData } from "#handler/rest/index.js";
import { Queue } from "#core/queue/structures/queue.js";
import { QueueMessage } from "./modules/message.js";
import { Collection, locale } from "#structures";
import { env } from "#db/env";
import { db } from "#db";

export * from "./structures/tracks.js";
export * from "./structures/voice.js";
export * from "./structures/track.js";
export * from "./structures/queue.js";

/**
 * @author SNIPPIK
 * @description Базовый класс контроллера очередей, содержит в себе главные функции управления
 * @class BaseQueueController
 * @private
 */
class BaseQueueController<T extends Queue = Queue> extends Collection<T> {
    /** Хранилище циклов для работы музыки */
    public cycles = new ControllerCycles();

    /**
     * @description Создание очереди.
     * @public
     */
    public create = (message: CommandInteraction) => {
        let queue = this.get(message.guildId);

        // Если нет очереди
        if (!queue) {
            queue = new Queue(message) as T;

            // Добавляем очередь непосредственно в Collection
            this.set(message.guildId, queue);
        }

        // Обновляем данные в очереди
        else {
            // Если плеер не в цикле и не готовит трек
            if (!this.cycles.players.has(queue.player) && !queue.player.audio.preloaded) {
                setImmediate(() => {
                    const player = queue.player;

                    switch (db.queues.options.replay) {
                        case 1: {
                            queue.tracks.position = queue.tracks.total - 1;
                            break;
                        }

                        default: {
                            queue.tracks.position = 0;
                            break;
                        }
                    }

                    if (player.status === "player/pause") {
                        player.resume();
                    }

                    void player.play().catch(error => {
                        throw error;
                    });

                    if (queue.message.channel_id !== message.channelId) {
                        queue.message = new QueueMessage(message);
                    }
                });
            }
        }

        return queue;
    };

    /**
     * @description Выключение системы очереди.
     * @public
     */
    public shutdown = () => {
        let timeout = 0;

        for (const queue of this.array) {
            if (!queue.player.playing || !queue.player.audio?.current) {
                continue;
            }

            if (this.cycles.players.has(queue.player)) {
                const remaining = queue.player.audio.current.packets * 20;

                if (timeout < remaining) {
                    timeout = remaining;
                }
            }

            queue.message.send({
                withResponse: false,
                embeds: [
                    {
                        //@ts-ignore
                        description: locale._(queue.message.locale, `self.reboot`),
                        color: Colors.Yellow
                    }
                ]
            }).then((msg) => {
                setTimeout(() => {
                    if (msg.delete) {
                        msg.delete().catch(() => null);
                    }
                }, timeout ?? 1e3);
            });

            queue.player.removeAllListeners();

            this.remove(queue.message.guild_id, true);
        }

        return timeout;
    };
}

/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера - 1 очередь и плеер
 * @class ControllerQueues
 * @public
 */
export class ControllerQueues<T extends Queue> extends BaseQueueController<T> {
    /** Здесь хранятся модификаторы аудио */
    public options = {
        optimization: parseInt(env.get("duration.optimization", "15")),
        volume: parseInt(env.get("audio.volume", "70")),
        swapFade: parseInt(env.get("audio.swap.fade", "5")),
        fade: parseInt(env.get("audio.fade", "10")),

        replay: parseInt(env.get("replay.type", "1"))
    };
}

/**
 * @author SNIPPIK
 * @description События глобальной системы очередей
 * @interface QueueEvents
 * @public
 */
export interface QueueEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param queue      - Очередь сервера
     * @param user       - Пользователь включивший трек
     * @param items      - Трек или плейлист, альбом
     * @returns void
     * @readonly
     */
    readonly "message/push": (msg: CycleInteraction, queue: Queue, items: Track | APIRequestData.List<Track>) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "message/playing": (queue: Queue) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка
     * @returns void
     * @readonly
     */
    readonly "message/error": (queue: Queue, error?: string | Error, position?: number) => void;

    /**
     * @description Событие при котором очередь очищается и становится в режим ожидания, простым языком "player-end-playing"
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/cleanup": (queue: Queue) => void;

    /**
     * @description Событие при котором очередь полностью удаляется со всеми компонентами
     * @param queue     - Очередь сервера
     * @returns void
     * @readonly
     */
    readonly "queue/destroy": (queue: Queue) => void;
}