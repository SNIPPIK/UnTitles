import { readFileSync, writeFileSync } from "node:fs";
import { config, DotenvPopulateInput } from "dotenv";
import os from "node:os";

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 * @public
 */
class Environment {
  /**
   * @description Загружаем .env файл
   * @readonly
   * @private
   */
  private readonly dotenv = config();

  /**
   * @description Получаем значение
   * @param name {string} Имя
   * @readonly
   * @public
   */
  public readonly get = (name: keyof DotenvPopulateInput): any => {
    const env = this.dotenv.parsed[name];

    // Если нет параметра в файле .env
    if (!env) throw new Error(`[ENV]: Not found ${name} in .env`);

    // Проверяем параметр для конвертации
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
    // Открываем файл env в array
    const envFile = readFileSync(".env", "utf8").split(os.EOL);

    // Ищем имя
    const target = envFile.indexOf(
      envFile.find((line) => line.match(new RegExp(key))),
    );

    // Обновляем данные
    envFile.splice(target, 1, `${key}="${value}"`);

    try {
      // Сохраняем файл
      writeFileSync(".env", envFile.join(os.EOL));

      // Обновляем env
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

/**
 * @author SNIPPIK
 * @description Взаимодействуем с environment variables
 * @class Environment
 */
export const env = new Environment();

/**
 * @description Все prototype объектов
 * @remark
 * Использовать с умом, если попадут не те данные то могут быть ошибки
 */
const prototypes: { type: any, name: string, value: any}[] = [
  // Array
  {
    type: Array.prototype, name: "ArraySort",
    value: function (number = 5, callback: (value: number, index: number) => void, joined = "\"\\n\\n\"") {
      const pages: string[] = [];
      let page: string = '';

      for (let i = 0; i < this.length; i += number) {
        page = this.slice(i, i + number).map((value: number, index: number) => callback(value, index)).join(joined);
        if (page !== '') pages.push(page);
      }

      return pages;
    }
  },

  // String
  {
    type: String.prototype, name: "duration",
    value: function () {
      const time = this?.split(":").map(Number) ?? [parseInt(this)];
      return time.length === 1 ? time[0] : time.reduce((acc: number, val: number) => acc * 60 + val);
    }
  },

  // Number
  {
    type: Number.prototype, name: "duration",
    value: function () {
      const days = Math.floor(this / (60 * 60 * 24)).toSplit() as number;
      const hours = Math.floor((this % (60 * 60 * 24)) / (60 * 60)).toSplit() as number;
      const minutes = Math.floor((this % (60 * 60)) / 60).toSplit() as number;
      const seconds = Math.floor(this % 60).toSplit() as number;

      return (days > 0 ? `${days}:` : "") + (hours > 0 || days > 0 ? `${hours}:` : "") + (minutes > 0 ? `${minutes}:` : "00:") + (seconds > 0 ? `${seconds}` : "00");
    }
  },
  {
    type: Number.prototype, name: "toSplit",
    value: function () {
      const fixed = parseInt(this as string);
      return (fixed < 10) ? ("0" + fixed) : fixed;
    }
  },
  {
    type: Number.prototype, name: "random",
    value: function (min = 0) {
      return Math.floor(Math.random() * (this - min) + min);
    }
  },
  {
    type: Number.prototype,
    name: "bytes",
    value: function() {
      const sizes = ["Bytes", "KB", "MB", "GB"];
      const i = Math.floor(Math.log(this) / Math.log(1024));
      return `${(this / Math.pow(1024, i)).toFixed(2)} ${sizes[i]}`;
    }
  }
];

/**
 * @description Задаем функции для их использования в проекте
 */
for (const property of prototypes) {
  Object.defineProperty(property.type, property.name, {value: property.value});
}

/**
 * @description Декларируем для TS
 * @global
 */
declare global {
  interface Array<T> {
    /**
     * @prototype Array
     * @description Превращаем Array в Array<Array>
     * @param number {number} Сколько блоков будет в Array
     * @param callback {Function} Как фильтровать
     * @param joined {string} Что добавить в конце
     */
    ArraySort(number: number, callback: (value: T, index?: number) => string, joined?: string): string[];
  }
  interface String {
    /**
     * @prototype String
     * @description Превращаем 00:00 в число
     * @return number
     */
    duration(): number;
  }
  interface Number {
    /**
     * @prototype Number
     * @description превращаем число в байты
     * @return string
     */
    bytes(): string;

    /**
     * @prototype Number
     * @description Превращаем число в 00:00
     * @return string
     */
    duration(): string;

    /**
     * @prototype Number
     * @description Добавляем 0 к числу. Пример: 01:10
     * @return string | number
     */
    toSplit(): string | number;

    /**
     * @prototype Number
     * @description Получаем случайное число
     * @param min {number} Мин число
     */
    random(min?: number): number;
  }
}