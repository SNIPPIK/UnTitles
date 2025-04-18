import type { GuildMember} from "discord.js"
import {Command} from "@handler/commands";
import {Colors, Events} from "discord.js";
import {Interact, Assign} from "@utils";
import {locale} from "@service/locale";
import {Event} from "@handler/events";
import {db} from "@app";
import {env} from "@handler";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @event Events.InteractionCreate
 * @public
 */
class Interaction extends Assign<Event<Events.InteractionCreate>> {
    /**
     * @author SNIPPIK
     * @description Функции правил проверки, возвращает true или false
     * @true - Разрешено
     * @false - Запрещено
     */
    private intends: { name: Command["rules"][number], callback: (message: Interact) => boolean }[] = [
        {
            name: "voice",
            callback: (message) => {
                const VoiceChannel = message.voice.channel;

                // Если нет голосового подключения
                if (!VoiceChannel) {
                    message.FBuilder = { description: locale._(message.locale, "voice.need", [message.author]), color: Colors.Yellow };
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
                    message.FBuilder = { description: locale._(message.locale, "queue.need", [message.author]), color: Colors.Yellow };
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
                    message.FBuilder = { description: locale._(message.locale, "player.playing.off"), color: Colors.DarkRed };
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
                            if (message.me.voice.channel && message.me.voice.channel.members.filter((user) => !user.user.bot).size > 0) {
                                message.FBuilder = { description: locale._(message.locale, "voice.alt", [message.voice.channel]), color: Colors.Yellow };
                                return false;
                            }

                            // Если нет пользователей, то подключаемся к другому пользователю
                            else {
                                queue.voice = message.voice;
                                queue.message = message;

                                message.FBuilder = {
                                    description: locale._(message.locale, "voice.new", [message.voice.channel]),
                                    color: Colors.Yellow
                                };
                                return true;
                            }
                        }

                        // Если есть очередь, но нет голосовых подключений
                        else db.queues.remove(message.guild.id);
                    }

                    // Если нет очереди, но есть голосовое подключение
                    else {
                        const connection = db.voice.get(message.guild.id);

                        // Отключаемся от голосового канала
                        if (connection) connection.disconnect;
                    }
                }

                return true;
            }
        }
    ];

    /**
     * @author SNIPPIK
     * @description База данных для системы ожидания
     * @private
     */
    private cooldown = env.get("cooldown", true) ? {
        time: parseInt(env.get("cooldown.time", "2")),
        db: new Map<string, number>
    } : null;

    /**
     * @description Создание события
     * @public
     */
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            once: false,
            execute: async (message) => {
                // Какие действия надо просто игнорировать
                if (
                    // Игнорируем ботов
                    (message.user || message?.member?.user).bot ||

                    // Системные кнопки которые не отслеживаются здесь!
                    "customId" in message && (`${message.customId}`.startsWith("menu_"))
                ) return;

                // Модифицированный класс сообщения
                const interact = new Interact(message);

                // Если включен режим белого списка
                if (db.whitelist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.whitelist.ids.length > 0 && !db.whitelist.ids.includes(message.user.id)) {
                        interact.FBuilder = {
                            description: locale._(interact.locale, "whitelist.message", [interact.author]),
                            color: Colors.Yellow
                        }

                        return;
                    }
                }

                // Если включен режим черного списка
                else if (db.blacklist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.blacklist.ids.length > 0 && !db.blacklist.ids.includes(message.user.id)) {
                        interact.FBuilder = {
                            description: locale._(interact.locale, "blacklist.message", [interact.author]),
                            color: Colors.Yellow
                        }

                        return;
                    }
                }

                // Если пользователь не является разработчиком, то на него будут накладываться штрафы в виде cooldown
                else if (!db.owner.ids.includes(message.user.id) && !message.isAutocomplete()) {
                    const user = this.cooldown.db.get(message.user.id);

                    // Если нет пользователя в системе ожидания
                    if (!user) {
                        // Добавляем пользователя в систему ожидания
                        this.cooldown.db.set(message.user.id, Date.now() + (this.cooldown.time * 1e3));
                    }

                    // Если пользователь уже в списке
                    else {
                        // Если время еще не прошло говорим пользователю об этом
                        if (user >= Date.now()) {
                            if (message.isAutocomplete()) return;

                            interact.FBuilder = {
                                description: locale._(interact.locale, "cooldown.message", [interact.author, (user / 1000).toFixed(0), 5]),
                                color: Colors.Yellow
                            }
                            return;
                        }

                        // Удаляем пользователя из базы
                        this.cooldown.db.delete(message.user.id);
                    }
                }


                // Если используется функция ответа от бота
                if (message.isAutocomplete()) {
                    // Если пользователь ищет трек
                    if (message.commandName === "play") {
                        const args = interact.options._hoistedOptions;

                        // Если ничего не было указано или указана ссылка
                        if (!args[1]?.value || args[1]?.value === "") return;

                        const request = db.api.request(args[0].value as string);

                        // Если с платформы нельзя получить данные
                        if (request.block || request.auth) return;

                        db.events.emitter.emit("rest/request-complete", request, interact, args[1].value as string);
                    }
                    return;
                }

                // Если пользователь использует команду
                else if (message.isChatInputCommand() && !message.isAutocomplete()) {
                    const command = interact.command;

                    // Если нет команды
                    if (!command) {
                        db.commands.remove(message.client, message.commandGuildId, message.commandId);
                        interact.FBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если пользователь пытается использовать команду разработчика
                    else if (command?.owner && !db.owner.ids.includes(interact.author.id)) {
                        interact.FBuilder = { description: locale._(interact.locale, "command.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если права не соответствуют правде
                    else if (command.rules && command.rules?.length > 0) {
                        let isContinue = true;

                        for (const rule of this.intends) {
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

                    // Если надо дать время на обработку
                    if (command.deferReply) await message.deferReply().catch(() => {});

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
                    const button = db.buttons.get(interact.custom_id);
                    const queue = interact?.queue;

                    // Если была не найдена кнопка
                    if (!button) {
                        interact.FBuilder = { description: locale._(interact.locale, "button.fail"), color: Colors.DarkRed };
                        return;
                    }

                    // Если пользователь не подключен к голосовым каналам и нет очереди
                    else if (!interact.voice.channel || !interact.guild.members.me.voice.channel) return;

                    // Если есть очередь и пользователь не подключен к тому же голосовому каналу
                    else if (!queue || interact.voice.channel?.id !== queue.voice.channel.id) return;

                    // Если кнопка была найдена
                    button.callback(interact);
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