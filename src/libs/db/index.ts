import { Database_Commands } from "./Global/Commands";
import { Handler } from "@lib/handler";
import { Client } from "discord.js";

/**
 * @author SNIPPIK
 * @description База с загрузчиками
 */
const loaders: {
  name: string;
  callback: (client: Client, item: any) => void;
}[] = [
  /**
   * @description Загрузчик handlers/Commands, загружает slashcommand для взаимодействия с ботом
   */
  {
    name: "handlers/Commands",
    callback: (_, item: Handler.Command) => {
      if (item.data.options) {
        for (const option of item.data.options) {
          if ("options" in option)
            db.commands.subCommands += option.options.length;
        }
        db.commands.subCommands += item.data.options.length;
      }
      db.commands.push(item);
    },
  },
  /**
   * @description Загрузчик handlers/Events, загружает ивенты для управления событиями бота
   */
  {
    name: "handlers/Events",
    callback: (client, item: Handler.Event<any>) => {
      client.on(item.name as any, (...args) => item.execute(client, ...args));
    },
  },
];

/**
 * @author SNIPPIK
 * @class Database
 * @description База данных бота
 * @public
 */
class SimpleDB {
  private readonly loaded = {
    commands: new Database_Commands(),
  };

  /**
   * @description Выдаем класс с командами
   * @public
   */
  public get commands() {
    return this.loaded.commands;
  }

  /**
   * @description Запускаем index
   * @param client {Client} Класс клиента
   * @public
   */
  public set initialize(client: Client) {
    (async () => {
      //Постепенно загружаем директории с данными
      for (const handler of loaders) {
        try {
          for (const file of new Handler(handler.name).files)
            handler.callback(client, file);
        } catch (err) {
          throw err;
        }
      }

      //Отправляем данные о командах на сервера discord
      await this.commands.register(client);
    })();
  }
}

export const db = new SimpleDB();
