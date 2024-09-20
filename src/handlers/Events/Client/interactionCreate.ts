import {Interact} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
import {Colors, Events} from "discord.js";
import {db} from "@lib/db";

const player_bottoms = ["shuffle", "last", "resume_pause", "skip", "repeat"];

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
class Interaction extends Constructor.Assign<Handler.Event<Events.InteractionCreate>> {
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            execute: (_, message) => {
                // Игнорируем ботов
                if ((message.user || message?.member?.user).bot) return;

                // Если пользователь использует команду
                if (message.isCommand()) {
                    const msg = new Interact(message);

                    const interact = new Interact(message);
                    interact.command.execute({
                        message: msg,
                        args: msg.options?._hoistedOptions?.map((f) => `${f.value}`),
                        type: msg.options._subcommand
                    });

                    return;
                }

                // Если происходит взаимодействие с меню
                else if (message.isStringSelectMenu()) {
                    const msg = new Interact(message);

                    if (message.customId === "search-menu") {
                        db.audio.queue.events.emit("request/api", msg, [message.values[0], message.values[0]]);
                        message.message.delete().catch(() => {});
                        return;
                    }
                }

                // Управление кнопками
                else if (message.isButton()) {
                    // Если были задействованы кнопки плеера
                    if (player_bottoms.includes(message.customId)) return Interaction.bottom_Players(new Interact(message));
                }
            }
        });
    };

    /**
     * @description Управление кнопками плеера
     * @param msg - Модифицированное сообщение
     */
    private static readonly bottom_Players = (msg: Interact): void => {
        //Если пользователь не подключен к голосовым каналам и нет очереди
        if (!msg.voice.channel || !msg.guild.members.me.voice.channel) return;

        const queue = msg.queue;

        //Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (!queue || msg.voice.channel?.id !== queue.voice.channel.id) return;


        // Случайный трек
        if (msg.custom_id === "shuffle") {
            // Если в очереди менее 2 треков
            if (queue.songs.size < 2) {
                new msg.builder().addEmbeds([
                    { description: "В очереди менее 2 треков!", color: Colors.Yellow }
                ]).setTime(7e3).send = msg;
                return;
            }

            // Включение тасовки очереди
            queue.shuffle = !queue.shuffle;


            // Отправляем сообщение о включении или выключении тасовки
            new msg.builder().addEmbeds([
                { description: "Перетасовка очереди" + queue.shuffle ? "включена" : "выключена", color: Colors.Green}
            ]).setTime(7e3).send = msg;
            return;
        }

        // Прошлый трек
        else if (msg.custom_id === "last") {
            // Если играет 1 трек
            if (queue.songs.position === 0) {
                new msg.builder().addEmbeds([
                    { description: "Играет только 1 трек, прошлых треков нет!", color: Colors.Yellow }
                ]).setTime(10e3).send = msg;
                return;
            }

            // Меняем позицию трека в очереди
            if (queue.player.stream.duration < queue.songs.song.duration.seconds + 10) {
                queue.songs.swapPosition = queue.songs.position - 1;
                queue.player.play(queue.songs.song);
            } else {
                queue.player.stop();
                queue.songs.swapPosition = queue.songs.position - 2;
            }

            // Уведомляем пользователя о смене трека
            new msg.builder().addEmbeds([
                { description: "Прошлый трек бы вернут!", color: Colors.Yellow }
            ]).setTime(10e3).send = msg;
            return;
        }

        // Кнопка паузы/проигрывания
        else if (msg.custom_id === "resume_pause") {
            // Если плеер уже проигрывает трек
            if (queue.player.status === "player/playing") {
                // Приостанавливаем музыку если она играет
                queue.player.pause();

                // Сообщение о паузе
                new msg.builder().addEmbeds([
                    {
                        description: "Приостановка проигрывания!"
                    }
                ]).setTime(7e3).send = msg;
                return;
            }

            // Если плеер на паузе
            else if (queue.player.status === "player/pause") {
                // Возобновляем проигрывание если это возможно
                queue.player.resume();

                // Сообщение о возобновлении
                new msg.builder().addEmbeds([
                    {
                        description: "Возобновление проигрывания!"
                    }
                ]).setTime(7e3).send = msg;
                return;
            }
        }

        // Следующий трек
        else if (msg.custom_id === "skip") {
            if (queue.songs.size < 1) queue.player.stop();
            else {
                // Меняем позицию трека в очереди
                if (queue.player.stream.duration < queue.songs.song.duration.seconds + 10) {
                    queue.songs.swapPosition = queue.songs.position + 1;
                    queue.player.play(queue.songs.song);
                } else queue.player.stop();
            }

            // Уведомляем пользователя о пропущенном треке
            new msg.builder().addEmbeds([
                {
                    description: "Текущий трек был пропущен!", color: Colors.Green
                }
            ]).setTime(7e3).send = msg;
            return;
        }

        // Повтор
        else if (msg.custom_id === "repeat") {
            const loop = queue.repeat;

            // Включение всех треков
            if (loop === "off") {
                queue.repeat = "songs";

                new msg.builder().addEmbeds([
                    { description: "Включен повтор треков!", color: Colors.Green}
                ]).setTime(7e3).send = msg;
                return;
            }

            // Включение повтора трека
            else if (loop === "songs") {
                queue.repeat = "song";

                new msg.builder().addEmbeds([
                    { description: "Включен повтор текущего трека!", color: Colors.Green}
                ]).setTime(7e3).send = msg;
                return;
            }

            queue.repeat = "off";
            new msg.builder().addEmbeds([
                { description: "Повтор выключен!", color: Colors.Green}
            ]).setTime(7e3).send = msg;
            return;
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});