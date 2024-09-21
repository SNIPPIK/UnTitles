import {Interact, InteractRule} from "@lib/discord/utils/Interact";
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
                    const interact = new Interact(message);
                    const command = interact.command;

                    // Если нет команды
                    if (!command) {
                        interact.fastBuilder = { description: "Я не нахожу этой команды", color: Colors.DarkRed };
                        return;
                    }

                    // Если права не соответствуют правде
                    if (command.rules && command.rules?.length > 0) {
                        if (!InteractRule.check(command.rules, interact)) return;
                    }

                    // Выполняем команду
                    interact.command.execute({
                        message: interact,
                        args: interact.options?._hoistedOptions?.map((f) => `${f.value}`),
                        type: interact.options._subcommand
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
                msg.fastBuilder = { description: "В очереди менее 2 треков!", color: Colors.Yellow }
                return;
            }

            // Включение тасовки очереди
            queue.shuffle = !queue.shuffle;

            // Отправляем сообщение о включении или выключении тасовки
            msg.fastBuilder = { description: "Перетасовка очереди" + queue.shuffle ? "включена" : "выключена", color: Colors.Green }
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
            msg.fastBuilder = { description: "Прошлый трек бы вернут!", color: Colors.Yellow }
            return;
        }

        // Кнопка паузы/проигрывания
        else if (msg.custom_id === "resume_pause") {
            // Если плеер уже проигрывает трек
            if (queue.player.status === "player/playing") {
                // Приостанавливаем музыку если она играет
                queue.player.pause();

                // Сообщение о паузе
                msg.fastBuilder = { description: "Приостановка проигрывания!", color: Colors.Green }
                return;
            }

            // Если плеер на паузе
            else if (queue.player.status === "player/pause") {
                // Возобновляем проигрывание если это возможно
                queue.player.resume();

                // Сообщение о возобновлении
                msg.fastBuilder = { description: "Возобновление проигрывания!", color: Colors.Green }
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
            msg.fastBuilder = { description: "Текущий трек был пропущен!", color: Colors.Green }
            return;
        }

        // Повтор
        else if (msg.custom_id === "repeat") {
            const loop = queue.repeat;

            // Включение всех треков
            if (loop === "off") {
                queue.repeat = "songs";

                msg.fastBuilder = { description: "Включен повтор треков!", color: Colors.Green }
                return;
            }

            // Включение повтора трека
            else if (loop === "songs") {
                queue.repeat = "song";

                msg.fastBuilder = { description: "Включен повтор текущего трека!", color: Colors.Green }
                return;
            }

            queue.repeat = "off";
            msg.fastBuilder = { description: "Повтор выключен!", color: Colors.Green }
            return;
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});