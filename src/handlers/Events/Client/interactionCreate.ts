import {Interact, InteractRule} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
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
            execute: (_, message) => {
                // Какие действия надо просто игнорировать
                if (
                    // Игнорируем ботов
                    (message.user || message?.member?.user).bot ||

                    // Системные кнопки которые не отслеживаются здесь!
                    "customId" in message && (message.customId === "back" || message.customId === "next" || message.customId === "cancel")
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
                        if (!InteractRule.check(command.rules, interact)) return;
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

                // Если происходит взаимодействие с меню
                else if (message.isStringSelectMenu()) {

                    if (message.customId === "search-menu") {
                        db.audio.queue.events.emit("request/api", interact, [message.values[0], message.values[0]]);
                        message.message.delete().catch(() => {});
                        return;
                    }

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
export default Object.values({Interaction});