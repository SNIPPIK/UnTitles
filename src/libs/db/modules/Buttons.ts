import {Interact} from "@lib/discord/utils/Interact";
import {Constructor} from "@handler";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Доступные кнопки
 * @type SupportButtons
 */
type SupportButtons = "shuffle" | "last" | "resume_pause" | "skip" | "repeat" | "replay" | "queue" | "filters_menu" | "lyrics" | "stop_music";

/**
 * @author SNIPPIK
 * @description Класс хранящий в себе все кнопки для бота
 * @class Database_Buttons
 */
export class Database_Buttons extends Constructor.Collection<button, SupportButtons> {
    public constructor() {
        super();

        /**
         * @description Включение случайного трека
         * @button shuffle
         */
        this.set("shuffle", {
            callback: (msg) => {
                const queue = msg.queue;

                // Если в очереди менее 2 треков
                if (queue.songs.size < 2) {
                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.shuffle.fail"),
                        color: Colors.Yellow
                    };

                    return;
                }

                // Включение тасовки очереди
                queue.shuffle = !queue.shuffle;

                // Отправляем сообщение о включении или выключении тасовки
                msg.fastBuilder = {
                    description: locale._(msg.locale, queue.shuffle ? "player.button.shuffle.on" : "player.button.shuffle.off"),
                    color: Colors.Green
                }
            }
        });

        /**
         * @description Включение прошлого трека
         * @button last
         */
        this.set("last", {
            callback: (msg) => {
                const queue = msg.queue;

                // Если играет 1 трек
                if (queue.songs.position === 0) {
                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.last.fail"),
                        color: Colors.Yellow
                    };

                    return;
                }

                // Меняем позицию трека в очереди
                db.audio.queue.events.emit("request/time", queue, queue.songs.position - 1);

                // Уведомляем пользователя о смене трека
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.last"),
                    color: Colors.Yellow
                }
            }
        });

        /**
         * @description Кнопка паузы/проигрывания
         * @button resume_pause
         */
        this.set("resume_pause", {
            callback: (msg) => {
                const queue = msg.queue;

                // Если плеер уже проигрывает трек
                if (queue.player.status === "player/playing") {
                    // Приостанавливаем музыку если она играет
                    queue.player.pause();

                    // Сообщение о паузе
                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.pause"),
                        color: Colors.Green
                    }
                }

                // Если плеер на паузе
                else if (queue.player.status === "player/pause") {
                    // Возобновляем проигрывание если это возможно
                    queue.player.resume();

                    // Сообщение о возобновлении
                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.resume"),
                        color: Colors.Green
                    }
                }
            }
        });

        /**
         * @description Кнопка пропуска текущего трека
         * @button skip
         */
        this.set("skip", {
            callback: (msg) => {
                const queue = msg.queue;

                // Меняем позицию трека в очереди
                db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);

                // Уведомляем пользователя о пропущенном треке
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.skip"),
                    color: Colors.Green
                }
            }
        });

        /**
         * @description Включение и выключение повтора
         * @button repeat
         */
        this.set("repeat", {
            callback: (msg) => {
                const queue = msg.queue, loop = queue.repeat;

                // Включение всех треков
                if (loop === "off") {
                    queue.repeat = "songs";

                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.songs"),
                        color: Colors.Green
                    }
                    return;
                }

                // Включение повтора трека
                else if (loop === "songs") {
                    queue.repeat = "song";

                    msg.fastBuilder = {
                        description: locale._(msg.locale, "player.button.repeat.song"),
                        color: Colors.Green
                    }
                    return;
                }

                queue.repeat = "off";
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.repeat.off"),
                    color: Colors.Green
                }
            }
        });


        /**
         * @description Повтор текущего трека
         * @button replay
         */
        this.set("replay", {
            callback: (msg: Interact) => {
                const queue = msg.queue;

                // Запускаем проигрывание текущего трека
                queue.player.play(queue.songs.song);

                // Сообщаем о том что музыка начата с начала
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.replay", [queue.songs.song.title]),
                    color: Colors.Green
                };
            }
        });


        /**
         * @description Показ текущих треков
         * @button queue
         */
        this.set("queue", {
            callback: (msg: Interact) => {
                const queue = msg.queue;

                // Если треков менее 5
                if (queue.songs.total < 5) {
                    msg.fastBuilder = { description: locale._(msg.locale, "player.button.queue.small"), color: Colors.White };

                    return;
                }

                // Отправляем список треков с уничтожением через 40 сек
                msg.fastBuilder = { description: locale._(msg.locale, "player.button.queue", [queue.songs.total]), color: Colors.White };
            }
        });


        /**
         * @description Показ включенных фильтров
         * @button filters_menu
         */
        this.set("filters_menu", {
            callback: (msg) => {
                const queue = msg.queue;
                const filters = queue.player.filters.enable;

                // Если нет фильтров
                if (filters.length === 0) {
                    msg.fastBuilder = { description: locale._(msg.locale, "player.button.filter.zero"), color: Colors.White };

                    return;
                }

                // Отправляем список включенных фильтров
                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.filter", [filters.length, filters.map((flt) => flt.name).join(", ")]),
                    color: Colors.White
                };
            }
        });


        /**
         * @description Показ теста трека
         * @button lyrics
         */
        this.set("lyrics", {
            callback: (msg) => {
                msg.fastBuilder = { description: locale._(msg.locale, "player.button.lyrics"), color: Colors.White };
            }
        });

        /**
         * @description Остановка проигрывания
         * @button stop_music
         */
        this.set("stop_music", {
            callback: (msg) => {
                const queue = msg.queue;

                // Если есть очередь, то удаляем ее
                if (queue) queue.cleanup();
                Voice.remove(msg.guild.id);

                msg.fastBuilder = {
                    description: locale._(msg.locale, "player.button.stop"),
                    color: Colors.Green
                };
            }
        });
    };
}

/**
 * @author SNIPPIK
 * @description Что хранит в себе объект кнопки
 * @interface button
 */
interface button {
    callback: (msg: Interact) => void;
}