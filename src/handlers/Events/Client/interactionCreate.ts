import {Interact, InteractRule} from "@lib/discord/utils/Interact";
import {PlayerBT, PlayerBTNames} from "@lib/player/buttons";
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
                    if (PlayerBTNames.includes(message.customId)) return Interaction.BTPlayer(new Interact(message));
                }
            }
        });
    };

    /**
     * @description Управление кнопками плеера
     * @param msg - Модифицированное сообщение
     */
    private static readonly BTPlayer = (msg: Interact): void => {
        // Если пользователь не подключен к голосовым каналам и нет очереди
        if (!msg.voice.channel || !msg.guild.members.me.voice.channel) return;

        const queue = msg.queue;

        // Если есть очередь и пользователь не подключен к тому же голосовому каналу
        if (!queue || msg.voice.channel?.id !== queue.voice.channel.id) return;

        // Получаем действие кнопки
        const button = PlayerBT[msg.custom_id];

        // Временная заглушка
        if (!button) {
            msg.fastBuilder = {
                description: locale._(msg.locale, "button.fail"),
                color: Colors.DarkRed
            };
            return;
        }

        // Выполняем действие кнопки
        return button(msg);
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});