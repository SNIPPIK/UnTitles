import { CommandInteraction, CycleInteraction, Collection, Logger, SyncCycle } from "#structures";
import { AudioPlayer, Queue, Track } from "#service/player";
import { RestClientSide } from "#handler/rest/apis";
import { OPUS_FRAME_SIZE } from "#service/voice";
import { locale } from "#service/locale";
import { Colors } from "discord.js";
import { env } from "#app/env";
import { db } from "#app/db";

export * from "./structures/track";
export * from "./structures/queue";
export * from "./structures/player";
export * from "./modules/filters";
export * from "./modules/tracks";


/**
 * @author SNIPPIK
 * @description Безопасное время для буферизации трека
 * @const PLAYER_BUFFERED_TIME
 */
export const PLAYER_BUFFERED_TIME = 500;




/**
 * @author SNIPPIK
 * @description Загружаем класс для хранения очередей, плееров, циклов
 * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
 * @extends Collection
 * @class Queues
 * @public
 */
export class Queues<T extends Queue> extends Collection<T> {
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
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @public
     */
    public readonly cycles = new AudioCycles();

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
        let queue = this.get(message.guild.id);

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
                db.events.emitter.emit("message/push", message, item);
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
 * @description Циклы для работы аудио, лучше не трогать без понимания как все это работает
 * @class AudioCycles
 * @private
 */
class AudioCycles {
    /**
     * @author SNIPPIK
     * @description Цикл для работы плеера, необходим для отправки пакетов
     * @class AudioPlayers
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
    readonly "message/push": (message: CommandInteraction, items: Track | Track.list) => void;

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