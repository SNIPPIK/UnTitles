import { config, DotenvPopulateInput } from "dotenv";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 */
class Environment {
  private readonly dotenv = config();
  /**
   * @description Получаем значение
   * @param name {string} Имя
   * @readonly
   * @public
   */
  public readonly get = (name: keyof DotenvPopulateInput): any => {
    const env = this.dotenv.parsed[name];

    if (!env) throw new Error(`[ENV]: Not found ${name} in .env`);

    return env === "true" ? true : env === "false" ? false : env;
  };

  /**
   * @description Обновляем данные в env (не работает на некоторых хостингах)
   * @param key {string} Имя
   * @param value {string} значение
   * @readonly
   * @public
   */
  public readonly set = (key: string, value: string): void => {
    //Открываем файл env в array
    const envFile = readFileSync(".env", "utf8").split(os.EOL);

    //Ищем имя
    const target = envFile.indexOf(
      envFile.find((line) => line.match(new RegExp(key))),
    );

    //Обновляем данные
    envFile.splice(target, 1, `${key}="${value}"`);

    try {
      //Сохраняем файл
      writeFileSync(".env", envFile.join(os.EOL));

      //Обновляем env
      setImmediate(() => require("dotenv").config());
    } catch (e) {
      throw `[ENV]: Fail save >${key}< to .env`;
    }
  };

  /**
   * @description Проверяем есть ли данные
   * @param name {string} Имя
   * @readonly
   * @public
   */
  public readonly check = (name: string) => {
    const env = this.dotenv.parsed[name];

    return !(!env || env === "undefined");
  };
}

export const env = new Environment();
