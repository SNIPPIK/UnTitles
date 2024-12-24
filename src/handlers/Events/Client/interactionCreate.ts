import {Interact} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
import type { GuildMember} from "discord.js"
import {Colors, Events} from "discord.js";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description База данных для системы ожидания
 * @private
 */
const temple_db = new Map<string, number>;

/**
 * @author SNIPPIK
 * @description Функции правил проверки, возвращает true или false
 * @true - Разрешено
 * @false - Запрещено
 */
const intends: { name: Handler.Command["rules"][number], callback: (message: Interact) => boolean }[] = [
    {
        name: "voice",
        callback: (message) => {
            const VoiceChannel = message.voice.channel;

            // Если нет голосового подключения
            if (!VoiceChannel) {
                message.fastBuilder = { description: locale._(message.locale, "voice.need", [message.author]), color: Colors.Yellow };
                return false;
            }

            return true;
        }
    },
    {
        name: "queue",
        callback: (message) => {
            // Если нет очереди
            if (!message.queue) {
                message.fastBuilder = { description: locale._(message.locale, "queue.need", [message.author]), color: Colors.Yellow };
                return false;
            }

            return true;
        }
    },
    {
        name: "another_voice",
        callback: (message) => {
            const queue = message.queue;
            const VoiceChannel = (message.member as GuildMember)?.voice?.channel;

            // Если музыка играет в другом голосовом канале
            if (message.guild.members.me?.voice?.channel?.id !== VoiceChannel.id) {

                // Если включена музыка на сервере
                if (queue) {

                    // Если есть голосовое подключение
                    if (queue.voice && queue.voice.channel) {

                        // Если в гс есть другие пользователи
                        if (queue.voice.channel?.members?.size > 1) {
                            message.fastBuilder = { description: locale._(message.locale, "voice.alt", [message.voice.channel]), color: Colors.Yellow };
                            return false;
                        }

                        // Если нет пользователей, то подключаемся к другому пользователю
                        else {
                            queue.voice = message.voice;
                            queue.message = message;
                            message.fastBuilder = { description: locale._(message.locale, "voice.new", [message.voice.channel]), color: Colors.Yellow };
                            return true;
                        }
                    }
                }

                // Если нет очереди, но есть голосовое подключение
                else {
                    const connection = db.voice.get(message.guild.id);

                    // Отключаемся от голосового канала
                    if (connection) connection.disconnect();
                }
            }

            return true;
        }
    }
];

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @event Events.InteractionCreate
 * @public
 */
class Interaction extends Constructor.Assign<Handler.Event<Events.InteractionCreate>> {
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            execute: (_, message): void => {
                // Какие действия надо просто игнорировать
                if (
                    // Игнорируем ботов
                    (message.user || message?.member?.user).bot ||

                    // Системные кнопки которые не отслеживаются здесь!
                    "customId" in message && (`${message.customId}`.startsWith("menu_"))
                ) return;

                const interact = new Interact(message);
                const user = temple_db.get(message.user.id);

                // Если включен режим белого списка
                if (db.whitelist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (!db.whitelist.ids.includes(message.user.id)) {
                        interact.fastBuilder = {
                            description: locale._(interact.locale, "whitelist.message", [interact.author]),
                            color: Colors.Yellow
                        }

                        return;
                    }
                }

                // Если нет пользователя в системе ожидания
                else if (!user) {
                    // Добавляем пользователя в систему ожидания
                    temple_db.set(message.user.id, Date.now() + 5e3);
                }

                // Если пользователь уже в списке
                else {
                    // Если время еще не прошло говорим пользователю об этом
                    if (user >= Date.now()) {
                        interact.fastBuilder = {
                            description: locale._(interact.locale, "cooldown.message", [interact.author, (user / 1000).toFixed(0), 5]),
                            color: Colors.Yellow
                        }
                        return;
                    }

                    // Удаляем пользователя из базы
                    temple_db.delete(message.user.id);
                }



                // Если пользователь использует команду
                if (message.isCommand()) {
                    const command = interact.command;

                    // Если нет команды
                    if (!command) {
                        interact.fastBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если права не соответствуют правде
                    else if (command.rules) {
                        // Проверяем всю базу
                        for (const key of command.rules) {
                            const intent = intends[key];

                            // Если нет этого необходимости проверки запроса, то пропускаем
                            if (!intent.callback(interact)) continue;
                            else return;
                        }
                    }

                    // Выполняем команду
                    interact.command.execute({
                        message: interact,
                        args: interact.options?._hoistedOptions?.map((f) => `${f.value}`),
                        type: interact.options._subcommand
                    });

                    // Завершаем действие
                    return;
                }

                // Управление кнопками
                else if (message.isButton()) {
                    const button = db.buttons.get(interact.custom_id as any);
                    const queue = interact?.queue;

                    // Если пользователь не подключен к голосовым каналам и нет очереди
                    if (!interact.voice.channel || !interact.guild.members.me.voice.channel) return;

                    // Если есть очередь и пользователь не подключен к тому же голосовому каналу
                    else if (!queue || interact.voice.channel?.id !== queue.voice.channel.id) return;

                    // Если была найдена кнопка
                    else if (button) button(interact);

                    // Если кнопка была не найдена
                    else interact.fastBuilder = { description: locale._(interact.locale, "button.fail"), color: Colors.DarkRed };

                    // Завершаем действие
                    return;
                }
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ Interaction });