import { SlashBuilder } from "@lib/discord/utils/SlashBuilder";
import { Constructor, Handler } from "@handler";

/**
 * @class TestCommand
 * @command info
 * @description Публичные данные бота
 */
class TestCommand extends Constructor.Assign<Handler.Command> {
  public constructor() {
    super({
      data: new SlashBuilder()
        .setName("test")
        .setDescription("А ты что думал?!").json,
      execute: ({ message }) => {
        message.send = {
          embeds: [
            {
              title: "Test",
              description: "Test description"
            }
          ]
        }
      },
    });
  }
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default Object.values({ TestCommand });
