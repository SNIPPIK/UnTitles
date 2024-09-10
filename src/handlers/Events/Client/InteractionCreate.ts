import { CommandInteractionOption, Events } from "discord.js";
import { Constructor, Handler } from "@handler";
import {Interact} from "@lib/discord/utils/Interact";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 */
class Interaction extends Constructor.Assign<
  Handler.Event<Events.InteractionCreate>
> {
  public constructor() {
    super({
      name: Events.InteractionCreate,
      type: "client",
      execute: (_, message: any) => {
        //Игнорируем ботов
        if ((message.user || message?.member?.user).bot || !message?.isCommand()) return;

        const interact = new Interact(message);
        interact.command.execute({message: interact});
      },
    });
  }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ Interaction });
