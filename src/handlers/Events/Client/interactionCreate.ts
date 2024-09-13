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
                msg.send({
                    embeds: [
                        { description: "В очереди менее 2 треков!", color: Colors.Yellow }
                    ]
                });
                return;
            }

            // Включение тасовки очереди
            queue.shuffle = !queue.shuffle;


            // Отправляем сообщение о включении или выключении тасовки
            msg.send({
                embeds: [
                    { description: "Перетасовка очереди" + queue.shuffle ? "включена" : "выключена"}
                ]
            })

            return;
        }

        // Прошлый трек
        else if (msg.custom_id === "last") {
            // Если треков менее 2
            if (queue.songs.size < 2) return;
            else if (queue.songs.size > 1) {
                const index = queue.songs.size - 1;
                queue.songs[0] = queue.songs[index];
                queue.songs[index] = queue.songs.song;
            }

            // Пропускаем текущий трек
            queue.player.stop();

            msg.send({
                embeds: [
                    { description: "Трек бы вернут!" }
                ]
            })

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
                ]).setTime(7e0).send = msg;
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
                ]).setTime(7e0).send = msg;
                return;
            }
        }

        // Следующий трек
        else if (msg.custom_id === "skip") {
            return db.commands.get("skip").execute({ message: msg, args: ["1"], type: null });
        }

        // Повтор
        else if (msg.custom_id === "repeat") {
            const loop = queue.repeat;

            // Включение всех треков
            if (loop === "off") {
                queue.repeat = "songs";

                msg.send({
                    embeds: [
                        { description: "Включен повтор треков!" }
                    ]
                });
                return;
            }

            // Включение повтора трека
            else if (loop === "songs") {
                queue.repeat = "song";

                msg.send({
                    embeds: [
                        { description: "Включен повтор текущего трека!" }
                    ]
                });
                return;
            }

            queue.repeat = "off";
            msg.send({
                embeds: [
                    { description: "Выключен повтор!" }
                ]
            });
            return;
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});