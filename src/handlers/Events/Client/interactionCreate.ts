import {Interact} from "@lib/discord/utils/Interact";
import {Constructor, Handler} from "@handler";
import {Events} from "discord.js";

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
                //Игнорируем ботов
                if ((message.user || message?.member?.user).bot || !message?.isCommand()) return;

                const msg = new Interact(message);

                const interact = new Interact(message);
                interact.command.execute({
                    message: msg,
                    args: msg.options?._hoistedOptions?.map((f) => `${f.value}`),
                    type: msg.options._subcommand
                });
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({Interaction});