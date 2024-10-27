import {Interact} from "@lib/discord/utils/Interact";
import {locale} from "@lib/locale";
import {Colors} from "discord.js";
import {Voice} from "@lib/voice";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Все кнопки плеера, для взаимодействия с плеером и вспомогательными модулями
 */
export const PlayerBT = {
    /**
     * @description Включение случайного трека
     * @param msg
     */
    "shuffle": (msg: Interact) => {
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
    },

    /**
     * @description Включение прошлого трека
     * @param msg
     */
    "last": (msg: Interact) => {
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
    },

    /**
     * @description Кнопка паузы/проигрывания
     * @param msg
     */
    "resume_pause": (msg: Interact) => {
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
    },

    /**
     * @description Кнопка паузы/проигрывания
     * @param msg
     */
    "skip": (msg: Interact) => {
        const queue = msg.queue;

        // Меняем позицию трека в очереди
        db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);

        // Уведомляем пользователя о пропущенном треке
        msg.fastBuilder = {
            description: locale._(msg.locale, "player.button.skip"),
            color: Colors.Green
        }
    },

    /**
     * @description Кнопка паузы/проигрывания
     * @param msg
     */
    "repeat": (msg: Interact) => {
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
    },

    /**
     * @description Кнопка паузы/проигрывания
     * @param msg
     */
    "replay": (msg: Interact) => {
        const queue = msg.queue;

        // Запускаем проигрывание текущего трека
        queue.player.play(queue.songs.song);

        // Сообщаем о том что музыка начата с начала
        msg.fastBuilder = {
            description: locale._(msg.locale, "player.button.replay", [queue.songs.song.title]),
            color: Colors.Green
        };
    },

    /**
     * @description Кнопка паузы/проигрывания
     * @param msg
     */
    "stop_music": (msg: Interact) => {
        const queue = msg.queue;

        // Если есть очередь, то удаляем ее
        if (queue) queue.cleanup();
        Voice.remove(msg.guild.id);

        msg.fastBuilder = {
            description: locale._(msg.locale, "player.button.stop"),
            color: Colors.Green
        };
    }
};

/**
 * @author SNIPPIK
 * @description Имена всех кнопок плеера
 */
export const PlayerBTNames: keyof typeof PlayerBT = Object.keys(PlayerBT) as any;