import { Colors, CommandInteraction, CycleInteraction } from "#structures/discord";
import { APIRequestData, RestClientSide } from "#handler/rest";
import { ControllerCycles } from "./controllers/cycle";
import { Queue } from "#core/queue/structures/queue";
import { Track } from "#core/queue/structures/track";
import { QueueMessage } from "./modules/message";
import { Collection, locale } from "#structures";
import { env } from "#app/env";

export * from "./structures/tracks";
export * from "./structures/voice";
export * from "./structures/track";
export * from "./structures/queue";

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
                    if (queue.tracks.size > 0) queue.tracks.position++;

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
            } as any).then((msg) => {
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
     * @description Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     * @returns void
     * @readonly
     */
    readonly "rest/request": (api: RestClientSide.Request, message: CommandInteraction, url: string) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка
     * @returns void
     * @readonly
     */
    readonly "rest/error": (message: CommandInteraction, error: string | Error) => void;
}