import {Collection, Cycle, Interact, MessageUtils} from "@utils";
import {AudioPlayer, Queue, Track} from "@service/player";
import {Colors, Attachment} from "discord.js";
import {RestRequest} from "@handler/rest/apis";
import {locale} from "@service/locale";
import {env} from "@handler";
import {db} from "@app";


export * from "./structures/track";
export * from "./structures/queue";
export * from "./structures/player";
export * from "./modules/filters";
export * from "./modules/tracks";

/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @class Queues
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
     * @description Перезапуск плеера или же перезапуск проигрывания
     * @param player - Плеер
     * @public
     */
    public set restartPlayer(player: AudioPlayer) {
        // Если плеер удален из базы
        if (!this.cycles.players.match(player)) {
            // Добавляем плеер в базу цикла для отправки пакетов
            this.cycles.players.set(player);
        }

        // Если у плеера стоит пауза
        if (player.status === "player/pause") player.resume();

        // Запускаем функцию воспроизведения треков
        player.play();
    };

    /**
     * @description отправляем сообщение о перезапуске бота
     * @public
     */
    public get waitReboot() {
        let timeout = 0;

        // На все сервера отправляем сообщение о перезапуске
        for (const queue of this.array) {
            // Если плеер запущен
            if (this.cycles.players.match(queue.player)) {
                const time = queue.tracks.track.time.total * 1e3

                // Если время ожидания меньше чем в очереди
                if (timeout < time) timeout = time;
            }

            // Сообщение о перезапуске
            queue.message.FBuilder = {
                description: locale._(queue.message.locale, `bot.reboot.message`),
                color: Colors.Yellow
            };

            // Тихо удаляем очередь
            this.remove(queue.guild.id, true);
        }

        return timeout;
    };

    /**
     * @description Ультимативная функция, позволяет как добавлять треки так и создавать очередь или переподключить очередь к системе
     * @param message - Сообщение пользователя
     * @param item    - Добавляемый объект
     * @private
     */
    public create = (message: Interact, item: Track.list | Track) => {
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
                    this.restartPlayer = queue.player;
                });
            }
        }

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

/**
 * @author SNIPPIK
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @public
 */
class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
     * @readonly
     * @public
     */
    public readonly players = new class AudioPlayers extends Cycle<AudioPlayer> {
        public constructor() {
            super({
                name: "AudioPlayers",
                duration: 20,
                filter: (item) => item.playing,
                execute: (player) => {
                    // Отправляем пакет в голосовой канал
                    player.voice.connection.packet = player.audio.current.packet;
                }
            });
        };
    };

    /**
     * @author SNIPPIK
     * @description Цикл для обновления сообщений, необходим для красивого прогресс бара. :D
     * @class Messages
     * @readonly
     * @public
     */
    public readonly messages = new class Messages extends Cycle<Interact> {
        public constructor() {
            super({
                name: "Messages",
                duration: 20e3,
                custom: {
                    remove: (item) => { MessageUtils.deleteMessage(item, 200) },
                    push: (item) => {
                        const old = this.array.find(msg => msg.guild.id === item.guild.id);

                        // Удаляем прошлое сообщение
                        if (old) this.remove(old);
                    }
                },
                filter: (message) => message.editable,
                execute: (message) => {
                    const queue = message.queue;

                    // Если нет очереди
                    if (!queue) this.remove(message);

                    // Если есть поток в плеере
                    else if (queue.player.audio?.current && queue.player.audio.current.duration > 1) {
                        // Обновляем сообщение о текущем треке
                        db.events.emitter.emit("message/playing", queue, message);
                        return;
                    }
                }
            });
        };
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
 * @interface QueuesEvents
 * @public
 */
export interface QueuesEvents {
    /**
     * @description Событие при котором коллекция будет отправлять информацию о добавленном треке или плейлисте, альбоме
     * @param message - Сообщение с сервера
     * @param items   - Трек или плейлист, альбом
     */
    readonly "message/push": (message: Interact, items: Track | Track.list) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение о текущем треке
     * @param queue     - Очередь сервера
     * @param message   - Сообщение с сервера
     */
    readonly "message/playing": (queue: Queue, message?: Interact) => void;

    /**
     * @description Событие при котором коллекция будет отправлять сообщение об ошибке
     * @param queue     - Очередь сервера
     * @param error     - Ошибка в формате string или в типе Error
     */
    readonly "message/error": (queue: Queue, error?: string | Error) => void;

    /**
     * @description Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     */
    readonly "rest/request": (api: RestRequest, message: Interact, url: string | Attachment) => void;

    /**
     * @description  Событие при котором будет произведен поиск данных через систему API
     * @param api      - Класс платформы запросов
     * @param message  - Сообщение с сервера
     * @param url      - Ссылка на допустимый объект или текст для поиска
     */
    readonly "rest/request-complete": (api: RestRequest, message: Interact, url: string) => void;

    /**
     * @description Событие при котором будут отправляться ошибки из системы API
     * @param message    - Сообщение с сервера
     * @param error      - Ошибка в формате string
     */
    readonly "rest/error": (message: Interact, error: string) => void;
}