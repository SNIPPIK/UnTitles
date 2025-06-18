import { CommandInteraction, Collection, Logger } from "#structures";
import { AudioPlayer, Queue, Track } from "#service/player";
import { RestClientSide } from "#handler/rest";
import { locale } from "#service/locale";
import { Colors } from "discord.js";
import { env } from "#app/env";
import { db } from "#app/db";
import {ControllerCycles} from "#service/player/controllers/cycle";

export * from "./structures/track";
export * from "./structures/queue";
export * from "./structures/player";
export * from "./controllers/filters";
export * from "./controllers/tracks";

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
        fade: parseInt(env.get("audio.fade"))
    };

    /**
     * @description отправляем сообщение о перезапуске бота
     * @public
     */
    public get waitReboot() {
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
                        description: locale._(queue.message.locale, `bot.reboot.message`),
                        color: Colors.Yellow
                    }
                ]
            }).then((msg) => {
                setTimeout(() => {
                    if (msg.deletable) msg.delete().catch(() => null);
                }, 20e3);
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
    public set restartPlayer(player: AudioPlayer) {
        // Если плеер удален из базы
        if (!this.cycles.players.has(player)) {
            // Добавляем плеер в базу цикла для отправки пакетов
            this.cycles.players.add(player);
        }

        // Если у плеера стоит пауза
        if (player.status === "player/pause") player.resume();

        // Запускаем функцию воспроизведения треков
        player.play();
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
            if (!this.cycles.players.has(queue.player)) {
                setImmediate(() => {
                    // Если добавлен трек
                    if (item instanceof Track) queue.player.tracks.position = queue.player.tracks.total - 1;

                    // Если очередь перезапущена
                    else if (!item) queue.player.tracks.position = 0;

                    // Если добавлен плейлист
                    else queue.player.tracks.position = queue.player.tracks.total - item.items.length;

                    this.restartPlayer = queue.player;
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
 * @description События плеера
 * @interface AudioPlayerEvents
 * @public
 */
export interface AudioPlayerEvents {
    /**
     * @description Событие при котором плеер начинает завершение текущего трека
     * @param player - Текущий плеер
     * @param seek   - Время пропуска если оно есть
     */
    readonly "player/ended": (player: AudioPlayer, seek: number) => void;

    /**
     * @description Событие при котором плеер ожидает новый трек
     * @param player - Текущий плеер
     */
    readonly "player/wait": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер встает на паузу и ожидает дальнейших действий
     * @param player - Текущий плеер
     */
    readonly "player/pause": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер начинает проигрывание
     * @param player - Текущий плеер
     */
    readonly "player/playing": (player: AudioPlayer) => void;

    /**
     * @description Событие при котором плеер получает ошибку
     * @param player - Текущий плеер
     * @param err    - Ошибка в формате string
     * @param skip   - Если надо пропустить трек
     * @param position - Позиция трека в очереди
     */
    readonly "player/error": (player: AudioPlayer, err: string, track?: {skip: boolean, position: number}) => void;
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
    readonly "rest/request": (api: RestClientSide.Request, message: CommandInteraction, url: string | json) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    readonly "rest/error": (message: CommandInteraction, error: string) => void;
}