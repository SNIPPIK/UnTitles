import {AudioCycles, Queue, Track} from "@service/player";
import {Collection, Interact} from "@utils";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @readonly
 * @public
 */
export class Queues extends Collection<Queue> {
    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @public
     */
    public readonly cycles = new AudioCycles();

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
     * @description Ультимативная функция, позволяет как добавлять треки так и создавать очередь или переподключить очередь к системе
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     * @public
     */
    public create = (message: Interact, item: Track.playlist | Track) => {
        let queue = this.get(message.guild.id);

        // Проверяем есть ли очередь в списке, если нет то создаем
        if (!queue) queue = new Queue(message);
        else {
            // Значит что плеера нет в циклах
            if (!this.cycles.players.match(queue.player)) {
                setImmediate(() => {
                    // Если добавлен трек
                    if (item instanceof Track) queue.player.tracks.position = queue.player.tracks.total - 1;

                    // Если очередь перезапущена
                    else if (!item) queue.player.tracks.position = 0;

                    // Если добавлен плейлист
                    else queue.player.tracks.position = queue.player.tracks.total - item.items.length;

                    // Перезапускаем плеер
                    this.restartPlayer(queue);
                });
            }
        }

        // Добавляем данные в очередь
        this.pushItems(queue, message, item);
    };

    /**
     * @description Перезапуск плеера или же перезапуск проигрывания
     * @param queue - Очередь сервера для проигрывания музыки
     * @public
     */
    public restartPlayer = (queue: Queue) => {
        // Добавляем плеер в базу цикла для отправки пакетов
        this.cycles.players.set(queue.player);

        // Запускаем функцию воспроизведения треков
        setImmediate(queue.player.play);
    };

    /**
     * @description Добавление данных в очередь
     * @param queue   - Очередь сервера для проигрывания музыки
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     */
    private pushItems = (queue: Queue, message: Interact, item: Track.playlist | Track) => {
        // Отправляем сообщение о том что было добавлено
        if ("items" in item || queue.tracks.total > 0) {
            db.events.emitter.emit("message/push", message, item);
        }

        // Добавляем треки в очередь
        for (const track of (item["items"] ?? [item]) as Track[]) {
            track.user = message.author;
            queue.tracks.push(track);
        }
    };
}