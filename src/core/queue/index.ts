import { CommandInteraction, Colors } from "#structures/discord";
import { Collection, Logger, locale } from "#structures";
import { ControllerCycles } from "./controllers/cycle";
import { Queue } from "#core/queue/structures/queue";
import { QueueMessage } from "./structures/message";
import { RestClientSide } from "#handler/rest";
import { AudioPlayer } from "#core/player";
import { Track } from "./structures/track";
import { env } from "#app/env";
import { db } from "#app/db";

export * from "./structures/track";
export * from "./structures/queue";
export * from "./controllers/tracks";
export * from "./controllers/voice";

/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера - 1 очередь и плеер
 * @class ControllerQueues
 * @extends Collection
 * @public
 */
export class ControllerQueues<T extends Queue> extends Collection<T> {
    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @public
     */
    public readonly cycles = new ControllerCycles();

    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @public
     */
    public readonly options = {
        optimization: parseInt(env.get("duration.optimization")),
        volume: parseInt(env.get("audio.volume")),
        swapFade: parseInt(env.get("audio.swap.fade")),
        fade: parseInt(env.get("audio.fade"))
    };

    /**
     * @description Получаем время перезапуска и отправляем сообщения на сервера, где играет музыка!
     * @public
     */
    public get timeout_reboot() {
        let timeout = 0;

        // На все сервера отправляем сообщение о перезапуске
        for (const queue of this.array) {
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
                    if (msg.deletable) msg.delete().catch(() => null);
                }, timeout ?? 1e3);
            });

            // Отключаем события плеера
            queue.player.removeAllListeners();

            // Тихо удаляем очередь
            this.remove(queue.guild.id, true);
        }

        Logger.log("DEBUG", `[Queues] has getting max timeout: ${timeout} ms`);
        return timeout;
    };

    /**
     * @description Перезапуск плеера или же перезапуск проигрывания
     * @param player - Плеер
     * @public
     */
    public set restart_player(player: AudioPlayer) {
        // Если у плеера стоит пауза
        if (player.status === "player/pause") player.resume();

        // Запускаем функцию воспроизведения треков
        (() => player.play())();
    };

    /**
     * @description Ультимативная функция, позволяет как добавлять треки так и создавать очередь или переподключить очередь к системе
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     * @private
     */
    public create = (message: CommandInteraction, item?: Track.list | Track) => {
        let queue = this.get(message.guildId);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message) as T;
        else {
            // Значит что плеера нет в циклах
            if (!this.cycles.players.has(queue.player) && queue.player.status !== "player/pause") {
                setImmediate(() => {
                    // Если добавлен трек
                    if (item instanceof Track) queue.player.tracks.position = queue.player.tracks.total - 1;

                    // Если очередь перезапущена
                    else if (!item) queue.player.tracks.position = 0;

                    // Если добавлен плейлист
                    else queue.player.tracks.position = queue.player.tracks.total - item.items.length;

                    // Если разные текстовые каналы
                    if (queue.message.channelID !== message.channelId) {
                        // Меняем текстовый канал
                        queue.message = new QueueMessage(message);
                    }

                    this.restart_player = queue.player;
                });
            }
        }

        // Если вносятся треки
        if (item) {
            // Отправляем сообщение о том что было добавлено
            if ("items" in item || queue.tracks.total > 0) {
                db.events.emitter.emit("message/push", queue, message.member, item);
            }

            // Добавляем треки в очередь
            for (const track of (item["items"] ?? [item]) as Track[]) {
                track.user = message.member.user;
                queue.tracks.push(track);
            }
        }
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
     * @param queue     - Очередь сервера
     * @param user       - Пользователь включивший трек
     * @param items     - Трек или плейлист, альбом
     */
    readonly "message/push": (queue: Queue, user: CommandInteraction["member"], items: Track | Track.list) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     */
    readonly "message/playing": (queue: Queue) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка в формате string или в типе Error
     */
    readonly "message/error": (queue: Queue, error?: string | Error, position?: number) => void;

    /**
     * @description Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     */
    readonly "rest/request": (api: RestClientSide.Request, message: CommandInteraction, url: string) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    readonly "rest/error": (message: CommandInteraction, error: string) => void;
}