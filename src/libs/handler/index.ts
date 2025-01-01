import {SlashBuilder, SlashComponent} from "@lib/discord/utils/SlashBuilder";
import {CollectionAudioEvents} from "@lib/db/modules/Audio";
import {Interact} from "@lib/discord/utils/Interact";
import {AudioPlayerEvents} from "@lib/player";
import {APIs} from "@lib/db/modules/APIs";
import {ClientEvents} from "discord.js";
import {Client} from "@lib/discord";
import {readdirSync} from "node:fs";
import {Logger} from "@lib/logger";

/**
 * @author SNIPPIK
 * @description Класс для загрузки других классов
 * @class Handler
 * @public
 */
export class Handler<T> {
  /**
   * @description Загруженные файлы
   * @readonly
   * @private
   */
  private readonly _files: T[] = [];

  /**
   * @description Выдаем все загруженные файлы
   * @public
   */
  public get files() { return this._files; };

  /**
   * @description Загружаем файлы
   * @public
   */
  public constructor(directory: string) {
    // Загружаем каталог
    for (const dir of readdirSync(`src/${directory}`)) {
      if (dir.endsWith(".ts") && !dir.endsWith(".js")) {
        Logger.log("WARN", `[Handler] TypeError: File is not directory, need remove this file src/${directory}/${dir}`);
        continue;
      }

      // Загружаем 2 каталог
      for (const file of readdirSync(`src/${directory}/${dir}`)) {
        if (!file.endsWith(".ts") && !file.endsWith(".js")) {
          Logger.log("WARN", `[Handler] TypeError: File is directory, need remove this directory src/${directory}/${dir}`);
          continue
        }

        const imported = this.import_(`${directory}/${dir}/${file}`);

        if (!imported) continue;

        // Загружаем файл
        this.file(imported);
      }
    }
  };
  /**
   * @description Функция загрузки файла
   * @param imported
   */
  private readonly file = (imported: T | Error) => {
    // Если при загрузке была получена ошибка
    if (imported instanceof Error) throw imported;

    // Если полученные данные являются списком
    else if (imported instanceof Array) {
      for (const obj of imported) this._files.push(new obj(null));
    }

    // Если ничего выше описанного не было получено
    else this._files.push(new (imported as any)(null));
  };

  /**
   * @description Загружаем файл
   * @readonly
   * @private
   */
  private readonly import_ = (path: string): Error | T => {
    try {
      const file = require(`../../${path}`);

      // Удаляем кеш загрузки
      delete require.cache[require.resolve(path)];

      // Если нет импортируемых объектов
      if (!file?.default) return null;

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
 * @public
 */
export namespace Handler {
  /**
   * @author SNIPPIK
   * @description Интерфейс для событий
   * @interface Event
   * @public
   */
  export interface Event<T extends keyof ClientEvents | keyof CollectionAudioEvents | keyof AudioPlayerEvents> {
    /**
     * @description Название ивента
     * @default null
     * @readonly
     * @public
     */
    readonly name: T extends keyof CollectionAudioEvents ? keyof CollectionAudioEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    readonly type: T extends keyof CollectionAudioEvents | keyof AudioPlayerEvents ? "player" : "client";

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    readonly execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
  }

  /**
   * @author SNIPPIK
   * @description Интерфейс для команд
   * @interface Command
   * @public
   */
  export interface Command<T = ""> {
    /**
     * @description Данные команды для отправки на сервера discord
     * @default Необходим ввод данных
     * @readonly
     * @public
     */
    readonly builder: T extends "get" ? SlashBuilder["json"] : SlashBuilder;

    /**
     * @description Команду может использовать только разработчик
     * @default false
     * @readonly
     * @public
     */
    readonly owner?: boolean;

    /**
     * @description Права для использования той или иной команды
     * @default null
     * @readonly
     * @public
     */
    readonly rules?: ("voice" | "queue" | "another_voice")[]

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    readonly execute: (options: {
      /**
       * @description Сообщение пользователя для работы с discord
       */
      message: Interact;

      /**
       * @description Тип команды, необходимо для работы много ступенчатых команд
       * @warning Необходимо правильно понимать логику загрузки команд для работы с этим параметром
       */
      type: Command["builder"]["options"][number]["name"];

      /**
       * @description Аргументы пользователя будут указаны только в том случаем если они есть в команде
       */
      args?: SlashComponent["choices"][number]["value"][];
    }) => void;
  }

  /**
   * @author SNIPPIK
   * @description Создаем класс для итоговой платформы для взаимодействия с APIs
   * @interface API
   * @abstract
   * @public
   */
  export interface API {
    /**
     * @description Имя платформы
     * @readonly
     * @public
     */
    readonly name: "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

    /**
     * @description Ссылка для работы фильтра
     * @readonly
     * @public
     */
    readonly url: string;

    /**
     * @description Доступ к аудио
     * @readonly
     * @public
     */
    readonly audio: boolean;

    /**
     * @description Доступ с авторизацией
     * @readonly
     * @public
     */
    readonly auth: boolean;

    /**
     * @description Фильтр ссылки для работы определения
     * @readonly
     * @public
     */
    readonly filter: RegExp;

    /**
     * @description Цвет платформы
     * @readonly
     * @public
     */
    readonly color: number;

    /**
     * @description Запросы платформы
     * @readonly
     * @public
     */
    readonly requests: (APIs.track | APIs.playlist | APIs.album | APIs.author | APIs.search)[];
  }
}

/**
 * @author SNIPPIK
 * @description Классы упрощающие некоторые моменты, так-же содержит класс для запросов
 * @namespace Constructor
 * @public
 */
export namespace Constructor {
  /**
   * @author SNIPPIK
   * @description Коллекция
   * @abstract
   * @public
   */
  export abstract class Collection<K, T = string> {
    /**
     * @description База Map для взаимодействия с объектами через идентификатор
     * @readonly
     * @private
     */
    private readonly map = new Map<T, K>();

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: T) => {
      return this.map.get(ID);
    };

    /**
     * @description Добавляем объект в список
     * @param ID - ID объекта
     * @param value - Объект для добавления
     * @param promise - Если надо сделать действие с объектом
     * @public
     */
    public set = (ID: T, value: K, promise?: (item: K) => void) => {
      const item = this.get(ID);

      // Если нет объекта, то добавляем его
      if (!item) {
        if (promise) promise(value);
        this.map.set(ID, value);
        return value;
      }

      // Выдаем объект
      return item;
    };

    /**
     * @description Фильтруем данные по принципу подбора
     * @param fn - функция фильтрации
     */
    /*public match = (fn: (item: K) => boolean) => {
      for (const [_, value] of this.map) {
        const check = fn(value);

        // Если найдено совпадение
        if (check) return check;
      }

      return null;
    };*/

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @public
     */
    public remove = (ID: T) => {
      const item: any = this.map.get(ID);

      // Если найден объект, то удаляем все сопутствующее, если это возможно
      if (item) {
        if ("disconnect" in item) item?.disconnect();
        if ("cleanup" in item) item?.cleanup();
        if ("destroy" in item) item?.destroy();

        this.map.delete(ID);
      }
    };

    /**
     * @description Получаем случайный объект из класса MAP
     * @public
     */
    public get random(): K {
      const keys = Array.from(this.map.keys());
      const key = keys[Math.floor(Math.random() * keys.length)];

      return this.get(key);
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
      return this.map.size;
    };
  }

  /**
   * @author SNIPPIK
   * @description Загрузчик классов
   * @class Assign
   * @abstract
   * @public
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

  /**
   * @author SNIPPIK
   * @description База с циклами для дальнейшей работы этот класс надо подключить к другому
   * @class Cycle
   * @abstract
   * @public
   */
  export abstract class Cycle<T = unknown> {
    /**
     * @description Данные для работы цикла
     * @readonly
     * @private
     */
    private readonly data = {
      /**
       * @description База с объектами
       */
      array: [] as T[],

      /**
       * @description Время через которое надо будет выполнить функцию
       */
      time: 0
    };

    /**
     * @description Параметры для работы цикла
     * @readonly
     * @public
     */
    public readonly _config: TimeCycleConfig<T> = {
      name: "timeCycle",
      execute: null,
      filter: null,
      duration: 10e3,
      custom: {
        push: null
      }
    };

    /**
     * @description Создаем класс и добавляем параметры
     * @param options - Параметры для работы класса
     * @protected
     */
    protected constructor(options: TimeCycleConfig<T>) {
      Object.assign(this._config, options);
    };

    /**
     * @description Выдаем коллекцию
     * @public
     */
    public get array() { return this.data.array; }

    /**
     * @description Добавляем элемент в очередь
     * @param item - Объект T
     * @public
     */
    public set = (item: T) => {
      if (this._config.custom?.push) this._config.custom?.push(item);
      else if (this.data.array.includes(item)) this.remove(item);

      // Добавляем данные в цикл
      this.data.array.push(item);

      // Запускаем цикл
      if (this.data.array?.length === 1 && this.data.time === 0) {
        this.data.time = Date.now();
        setImmediate(this._stepCycle);
      }
    };

    /**
     * @description Удаляем элемент из очереди
     * @param item - Объект T
     * @public
     */
    public remove = (item: T) => {
      const index = this.data.array.indexOf(item);

      if (index !== -1) {
        if (this._config.custom?.remove) this._config.custom.remove(item);
        this.data.array.splice(index, 1);
      }
    };

    /**
     * @description Здесь будет выполнен прогон объектов для выполнения execute
     * @readonly
     * @private
     */
    private readonly _stepCycle = (): void => {
      if (this.data.array?.length === 0) {
        this.data.time = 0;
        return;
      }

      // Если цикл запущен с режимом обещания
      if (this._config.duration === "promise") {
        // Высчитываем время для выполнения
        this.data.time += 10e3;
      }

      // Если запущен стандартный цикл
      else {
        // Высчитываем время для выполнения
        this.data.time += this._config.duration;
      }

      for (let item of this.data.array) {
        const filtered = this._config.filter(item);

        try {
          if (filtered) {
            // Если цикл запущен с режимом обещания
            if (item instanceof Promise) {
              (this._config.execute(item) as Promise<boolean>)
                  // Если скачивание завершено
                  .then((bool) => {
                    if (!bool) this.remove(item);
                  })

                  // Если произошла ошибка при скачивании
                  .catch((error) => {
                    this.remove(item);
                    console.log(error);
                  });
            }

            // Если запущен стандартный цикл
            else this._config.execute(item);
          }
        } catch (error) {
          this.remove(item);
          console.log(error);
        }
      }

      // Выполняем функцию через ~this._time ms
      setTimeout(this._stepCycle, this.data.time - Date.now());
    };
  }
}

/**
 * @author SNIPPIK
 * @description Интерфейс для опций TimeCycle
 * @private
 */
interface TimeCycleConfig<T> {
  /**
   * @description Имя цикла, для удобства отладки
   * @readonly
   * @public
   */
  readonly name: string,

  /**
   * @description Функция для выполнения
   * @readonly
   * @public
   */
  readonly execute: (item: T) => void | Promise<boolean>,

  /**
   * @description Как фильтровать объекты, вдруг объект еще не готов
   * @readonly
   * @public
   */
  readonly filter: (item: T) => boolean,

  /**
   * @description Время прогона цикла, через n времени будет запущен цикл по новой
   * @readonly
   * @public
   */
  readonly duration: number | "promise",

  /**
   * @description Кастомные функции, необходимы для модификации или правильного удаления
   * @readonly
   * @public
   */
  readonly custom?: {
    /**
     * @description Изменить логику добавления
     * @param item - объект
     * @readonly
     * @public
     */
    readonly push?: (item: T) => void;

    /**
     * @description Изменить логику удаления
     * @param item - объект
     * @readonly
     * @public
     */
    readonly remove?: (item: T) => void;
  }
}