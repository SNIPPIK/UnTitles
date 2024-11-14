import {Interact, InteractRule} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
import {Colors, Events} from "discord.js";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

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

                    // Завершаем действие
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

                    // Завершаем действие
                    return;
                }

                // Управление кнопками
                else if (message.isButton()) {
                    const button = db.buttons.get(message.customId as any);
                    const msg = new Interact(message);

                    // Если пользователь не подключен к голосовым каналам и нет очереди
                    if (!msg.voice.channel || !msg.guild.members.me.voice.channel) return;

                    const queue = msg.queue;

                    // Если есть очередь и пользователь не подключен к тому же голосовому каналу
                    if (!queue || msg.voice.channel?.id !== queue.voice.channel.id) return;


                    // Если была найдена кнопка
                    if (button) button.callback(msg);

                    // Если кнопка была не найдена
                    else {
                        msg.fastBuilder = {
                            description: locale._(msg.locale, "button.fail"),
                            color: Colors.DarkRed
                        };
                    }

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