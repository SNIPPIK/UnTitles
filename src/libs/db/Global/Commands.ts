import { Client } from "@lib/discord";
import { Handler } from "@handler";
import { db } from "@lib/db";
import { env } from "@env";

export class Database_Commands<T extends Handler.Command> extends Array<T> {
  public subCommands = 0;

  /**
   * @description Ищем в array подходящий тип
   * @param names - Имя или имена для поиска
   * @public
   */
  public get = (names: string | string[]): T => {
    for (const cmd of this) {
      if (names instanceof Array) {
        for (const name of names) {
          if (cmd.data.name === name || cmd.data.name === name) return cmd;
        }
      } else if (cmd.data.name === names) return cmd;
    }

    return null;
  };

  /**
   * @description Команды для разработчика
   * @return Command[]
   * @public
   */
  public get owner() {
    return this.filter((command) => command.owner);
  }

  /**
   * @description Команды доступные для всех
   * @return Command[]
   * @public
   */
  public get public() {
    return this.filter((command) => !command.owner);
  }

  /**
   * @description Загружаем команды для бота в Discord
   * @param client {Client} Класс клиента
   * @return Promise<true>
   * @public
   */
  public register = (client: Client): Promise<boolean> => {
    return new Promise<true>((resolve) => {
      const guildID = env.get("owner.server"),
        guild = client.guilds.cache.get(guildID);

      // Загрузка глобальных команд
      client.application.commands
        .set(this.map((command) => command.data) as any)
        .catch((error) => {
          throw error;
        });

      return resolve(true);
    });
  };
}
