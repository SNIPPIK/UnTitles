import {Interact} from "@lib/discord/tools/Interact";
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
        name: "player-not-playing",
        callback: (message) => {
            // Если музыку нельзя пропустить из-за плеера
            if (!message.queue.player.playing) {
                message.fastBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
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
                        if (message.me.voice.channel.members.filter((user) => !user.user.bot).size > 0) {
                            message.fastBuilder = { description: locale._(message.locale, "voice.alt", [message.voice.channel]), color: Colors.Yellow };
                            return false;
                        }

                        // Если нет пользователей, то подключаемся к другому пользователю
                        else {
                            queue.voice = message.voice;
                            queue.message = message;

                            message.fastBuilder = {
                                description: locale._(message.locale, "voice.new", [message.voice.channel]),
                                color: Colors.Yellow
                            };
                            return true;
                        }
                    }

                    // Если есть очередь, но нет голосовых подключений
                    else db.audio.queue.remove(message.guild.id);
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
            once: false,
            execute: (_, message): void => {
                // Какие действия надо просто игнорировать
                if (
                    // Игнорируем ботов
                    (message.user || message?.member?.user).bot ||

                    // Системные кнопки которые не отслеживаются здесь!
                    "customId" in message && (`${message.customId}`.startsWith("menu_"))
                ) return;

                const interact = new Interact(message);

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

                // Если включен режим черного списка
                else if (db.blacklist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (!db.blacklist.ids.includes(message.user.id)) {
                        interact.fastBuilder = {
                            description: locale._(interact.locale, "blacklist.message", [interact.author]),
                            color: Colors.Yellow
                        }

                        return;
                    }
                }

                // Если пользователь не является разработчиком, то на него будут накладываться штрафы в виде cooldown
                else if (!db.owner.ids.includes(message.user.id)) {
                    const user = temple_db.get(message.user.id);

                    // Если нет пользователя в системе ожидания
                    if (!user) {
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
                }



                // Если пользователь использует команду
                if (message.isCommand()) {
                    const command = interact.command;

                    // Если нет команды
                    if (!command) {
                        interact.fastBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если пользователь пытается использовать команду разработчика
                    else if (command?.owner && !db.owner.ids.includes(interact.author.id)) {
                        interact.fastBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если права не соответствуют правде
                    else if (command.rules && command.rules?.length > 0) {
                        let isContinue = true;

                        for (const rule of intends) {
                            // Если будет найдено совпадение
                            if (command.rules.includes(rule.name)) {
                                // Если нет этого необходимости проверки запроса, то пропускаем
                                if (isContinue) isContinue = rule.callback(interact);
                                else break;
                            }
                        }

                        // Если нет доступа, то отклоняем
                        if (!isContinue) return;
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