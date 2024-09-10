import { SlashBuilder } from "@lib/discord/utils/SlashBuilder";
import { Interact } from "@lib/discord/utils/Interact";
import { ClientEvents } from "discord.js";
import { Client } from "@lib/discord";
import { readdirSync } from "node:fs";

/**
 * @author SNIPPIK
 * @description Класс для загрузки других классов
 * @class Handler
 */
export class Handler<T> {
  private readonly _files: T[] = [];

  /**
   * @description Выдаем все загруженные файлы
   * @public
   */
  public get files() {
    return this._files;
  }

  /**
   * @description Загружаем файлы
   * @public
   */
  public constructor(directory: string) {
    // Загружаем каталог
    for (const dir of readdirSync(`src/${directory}`)) {
      if (dir.endsWith(".ts") && !dir.endsWith(".js")) continue;

      // Загружаем 2 каталог
      for (const file of readdirSync(`src/${directory}/${dir}`)) {
        if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

        const imported = this.imports(`${directory}/${dir}/${file}`);

        // Если при загрузке была получена ошибка
        if (imported instanceof Error) throw imported;

        // Если полученные данные являются списком
        else if (imported instanceof Array) {
          for (const obj of imported) this._files.push(new obj(null));
        }

        // Если ничего выше описанного не было получено
        else this._files.push(new (imported as any)(null));
      }
    }
  }

  /**
   * @description Загружаем файл
   * @private
   */
  private imports = (path: string): Error | T => {
    try {
      const file = require(`../../${path}`);

      //Удаляем кеш загрузки
      delete require.cache[require.resolve(path)];

      if (!file?.default) return Error("Not found default import");

      return file.default;
    } catch (error) {
      return error;
    }
  };
}

/**
 * @author SNIPPIK
 * @description Интерфейсы для загрузки
 * @namespace Handler
 */
export namespace Handler {
  /**
   * @author SNIPPIK
   * @description Интерфейс для событий
   * @interface Event
   */
  export interface Event<T extends keyof ClientEvents /*| keyof CollectionAudioEvents | keyof AudioPlayerEvents*/> {
    /**
     * @description Название ивента
     * @default null
     * @readonly
     * @public
     */
    name: keyof ClientEvents;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    type: "client";

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    execute: (client: Client, ...args: ClientEvents[T]) => void;
  }

  /**
   * @author SNIPPIK
   * @description Интерфейс для команд
   * @interface Command
   */
  export interface Command {
    /**
     * @description Данные команды для отправки на сервера discord
     * @default Необходим ввод данных
     * @readonly
     * @public
     */
    data: SlashBuilder["json"];

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    owner?: boolean;

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    execute: (options: { message: Interact; args?: string[]; }) => void;
  }

  /**
   * @author SNIPPIK
   * @description Интерфейс для плагинов
   * @interface Plugin
   */
  export interface Plugin {
    /**
     * @description При загрузке плагина будет выполнена это функция
     * @public
     */
    start: (options: { client: Client }) => void;
  }
}

/**
 * @author SNIPPIK
 * @description Вспомогательные классы
 * @namespace Constructor
 */
export namespace Constructor {
  /**
   * @author SNIPPIK
   * @description Коллекция
   * @abstract
   */
  export abstract class Collection<K> {
    private readonly data = new Map<string, K>();
    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: string) => {
      return this.data.get(ID);
    };

    /**
     * @description Добавляем объект в список
     * @param ID - ID объекта
     * @param value - Объект для добавления
     * @param promise - Если надо сделать действие с объектом
     * @public
     */
    public set = (ID: string, value: K, promise?: (item: K) => void) => {
      const item = this.get(ID);

      if (!item) {
        if (promise) promise(value);
        this.data.set(ID, value);
        return value;
      }

      return item;
    };

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @public
     */
    public remove = (ID: string) => {
      const item: any = this.data.get(ID);

      if (item) {
        if ("disconnect" in item) item?.disconnect();
        if ("cleanup" in item) item?.cleanup();
        if ("destroy" in item) item?.destroy();

        this.data.delete(ID);
      }
    };

    /**
     * @description Получаем случайный объект из класса MAP
     * @public
     */
    public get random(): K {
      const keys = Array.from(this.data.keys());
      const key = keys[Math.floor(Math.random() * keys.length)];

      return this.get(key);
    }

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
      return this.data.size;
    }
  }

  /**
   * @author SNIPPIK
   * @description Загрузчик классов
   * @class Assign
   * @abstract
   */
  export abstract class Assign<T> {
    /**
     * @description Создаем команду
     * @param options {Command}
     * @protected
     */
    protected constructor(options: T) {
      Object.assign(this, options);
    }
  }
}
