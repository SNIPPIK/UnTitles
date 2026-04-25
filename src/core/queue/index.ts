import { Colors, CommandInteraction } from "#structures/discord/index.js";
import { ControllerCycles } from "./controllers/cycle.js";
import { Queue } from "#core/queue/structures/queue.js";
import { QueueMessage } from "./modules/message.js";
import { Collection, locale } from "#structures";
import { env } from "#app/env";

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
class BaseQueueController<T extends Queue> {
    /**
     * @description Хранилище очередей
     * @private
     */
    private queue: Collection<T> = new Collection();

    /**
     * @description Хранилище циклов для работы музыки
     * @public
     */
    public cycles = new ControllerCycles();

    /**
     * @description Создание очереди, можно создать очередь, не забываем что это просто объект которому надо указать как работать
     * @public
     */
    public set = (message: CommandInteraction) => {
        let queue = this.queue.get(message.guildId);

        // Если нет очереди
        if (!queue) {
            queue = new Queue(message) as T;

            // Добавляем очередь в список очередей
            this.queue.set(message.guildId, queue);
        }

        // Обновляем данные в очереди
        else {
            // Если плеер не играет
            if (!this.cycles.players.has(queue.player) && !queue.player.audio.preloaded) {
                setImmediate(async () => {
                    const player = queue.player;

                    // Ставим на последнюю позицию
                    if (queue.tracks.size > 0) {
                        // Меняем позицию на последнюю
                        queue.tracks.position = queue.tracks.total - 1;//queue.tracks.last_position + 1;
                    }

                    // Если у плеера стоит пауза
                    if (player.status === "player/pause") player.resume();

                    // Запускаем функцию воспроизведения треков
                    await player.play();
                });
            }

            // Если текстовый канал изменился — обновляем привязку
            if (queue.message.channel_id !== message.channelId) {
                queue.message = new QueueMessage(message);
            }
        }

        return queue;
    };

    /**
     * @description Получение очереди по уник id
     * @param ID - Уник id
     * @public
     */
    public get = (ID: string) => {
        return this.queue.get(ID);
    };

    /**
     * @description Кол-во очередей в текущем потоке
     * @public
     */
    public get size() {
        return this.queue.size;
    };

    /**
     * @description Удаление очереди, удаление со всеми составными без остатка
     * @public
     */
    public remove = (ID: string, silent = false) => {
        this.queue.remove(ID, silent);
    };

    /**
     * @description Выключение системы очереди, можно отложить выключение музыки на время максимального трека
     * @public
     */
    public shutdown = () => {
        let timeout = 0;

        // На все сервера отправляем сообщение о перезапуске
        for (const queue of this.queue.array) {
            // Если аудио не играет
            if (!queue.player.playing || !queue.player.audio?.current) continue;

            // Если плеер запущен
            if (this.cycles.players.has(queue.player)) {
                const remaining = queue.player.audio.current.packets * 20;

                // Если время ожидания меньше чем в очереди
                if (timeout < remaining) timeout = remaining;
            }

            // Уведомляем пользователей об окончании, для каждого сервера
            queue.message.send({
                withResponse: false,
                embeds: [
                    {
                        description: locale._(queue.message.locale, `self.reboot`),
                        color: Colors.Yellow
                    }
                ]
            }).then((msg) => {
                setTimeout(() => {
                    if (!!msg.delete) msg.delete().catch(() => null);
                }, timeout ?? 1e3);
            });

            // Отключаем события плеера
            queue.player.removeAllListeners();

            // Тихо удаляем очередь
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
 * @extends Collection
 * @public
 */
export class ControllerQueues<T extends Queue> extends BaseQueueController<T> {
    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @public
     */
    public options = {
        optimization: parseInt(env.get("duration.optimization", "15")),
        volume: parseInt(env.get("audio.volume", "70")),
        swapFade: parseInt(env.get("audio.swap.fade", "5")),
        fade: parseInt(env.get("audio.fade", "10"))
    };
}