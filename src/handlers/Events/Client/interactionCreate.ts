import {Interact, InteractRule} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
import {Colors, Events} from "discord.js";
import {locale} from "@lib/locale";
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
                        interact.fastBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
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
                msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.shuffle.fail"), color: Colors.Yellow }
                return;
            }

            // Включение тасовки очереди
            queue.shuffle = !queue.shuffle;

            // Отправляем сообщение о включении или выключении тасовки
            msg.fastBuilder = { description: locale._(msg.locale, queue.shuffle ? "player.bottom.shuffle.on" : "player.bottom.shuffle.off"), color: Colors.Green }
            return;
        }

        // Прошлый трек
        else if (msg.custom_id === "last") {
            // Если играет 1 трек
            if (queue.songs.position === 0) {
                new msg.builder().addEmbeds([
                    { description: locale._(msg.locale, "player.bottom.last.fail"), color: Colors.Yellow }
                ]).setTime(10e3).send = msg;
                return;
            }

            // Меняем позицию трека в очереди
            db.audio.queue.events.emit("request/time", queue, queue.songs.position - 1);

            // Уведомляем пользователя о смене трека
            msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.last"), color: Colors.Yellow }
            return;
        }

        // Кнопка паузы/проигрывания
        else if (msg.custom_id === "resume_pause") {
            // Если плеер уже проигрывает трек
            if (queue.player.status === "player/playing") {
                // Приостанавливаем музыку если она играет
                queue.player.pause();

                // Сообщение о паузе
                msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.pause"), color: Colors.Green }
            }

            // Если плеер на паузе
            else if (queue.player.status === "player/pause") {
                // Возобновляем проигрывание если это возможно
                queue.player.resume();

                // Сообщение о возобновлении
                msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.resume"), color: Colors.Green }
            }
            return;
        }

        // Следующий трек
        else if (msg.custom_id === "skip") {
            // Меняем позицию трека в очереди
            db.audio.queue.events.emit("request/time", queue, queue.songs.position + 1);

            // Уведомляем пользователя о пропущенном треке
            msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.skip"), color: Colors.Green }
            return;
        }

        // Повтор
        else if (msg.custom_id === "repeat") {
            const loop = queue.repeat;

            // Включение всех треков
            if (loop === "off") {
                queue.repeat = "songs";

                msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.repeat.songs"), color: Colors.Green }
                return;
            }

            // Включение повтора трека
            else if (loop === "songs") {
                queue.repeat = "song";

                msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.repeat.song"), color: Colors.Green }
                return;
            }

            queue.repeat = "off";
            msg.fastBuilder = { description: locale._(msg.locale, "player.bottom.repeat.off"), color: Colors.Green }
            return;
        }
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});