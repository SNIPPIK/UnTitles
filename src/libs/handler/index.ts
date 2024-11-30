import {Interact, InteractRules} from "@lib/discord/utils/Interact";
import { SlashBuilder } from "@lib/discord/utils/SlashBuilder";
import {CollectionAudioEvents} from "@lib/db/modules/Audio";
import {AudioPlayerEvents} from "@lib/player";
import { ClientEvents } from "discord.js";
import {Track} from "@lib/player/queue";
import { Client } from "@lib/discord";
import { readdirSync } from "node:fs";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Класс для загрузки других классов
 * @class Handler
 * @public
 */
export class Handler<T> {
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
      if (dir.endsWith(".ts") && !dir.endsWith(".js")) continue;

      // Загружаем 2 каталог
      for (const file of readdirSync(`src/${directory}/${dir}`)) {
        if (!file.endsWith(".ts") && !file.endsWith(".js")) continue;

        const imported = this.imports(`${directory}/${dir}/${file}`);

        if (!imported) continue;

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
  };

  /**
   * @description Загружаем файл
   * @private
   */
  private imports = (path: string): Error | T => {
    try {
      const file = require(`../../${path}`);

      //Удаляем кеш загрузки
      delete require.cache[require.resolve(path)];

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
    name: T extends keyof CollectionAudioEvents ? keyof CollectionAudioEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип ивента
     * @default null
     * @readonly
     * @public
     */
    type: T extends keyof CollectionAudioEvents | keyof AudioPlayerEvents ? "player" : "client";

    /**
     * @description Функция, которая будет запущена при вызове ивента
     * @default null
     * @readonly
     * @public
     */
    execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (...args: Parameters<AudioPlayerEvents[T]>) => any : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
  }

  /**
   * @author SNIPPIK
   * @description Интерфейс для команд
   * @interface Command
   * @public
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
     * @description Права для использования той или иной команды
     * @default null
     * @readonly
     * @public
     */
    rules?: InteractRules[]

    /**
     * @description Выполнение команды
     * @default null
     * @readonly
     * @public
     */
    execute: (options: { message: Interact; args?: string[]; type: string}) => void;
  }
}

/**
 * @author SNIPPIK
 * @description Вспомогательные классы
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
    private readonly data = new Map<T, K>();

    /**
     * @description Получаем объект из ID
     * @param ID - ID объекта
     * @public
     */
    public get = (ID: T) => {
      return this.data.get(ID);
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

      if (!item) {
        if (promise) promise(value);
        this.data.set(ID, value);
        return value;
      }

      return item;
    };

    /**
     * @description Фильтруем данные по принципу подбора
     * @param fn - функция фильтрации
     */
    public match = (fn: (item: K) => boolean) => {
      for (const [_, value] of this.data) {
        const check = fn(value);

        // Если найдено совпадение
        if (check) return check;
      }

      return null;
    };

    /**
     * @description Удаляем элемент из списка
     * @param ID - ID Сервера
     * @public
     */
    public remove = (ID: T) => {
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
    };

    /**
     * @description Получаем кол-во объектов в списке
     * @public
     */
    public get size() {
      return this.data.size;
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
    private readonly data = {
      array: [] as T[],
      time: 0
    };

    public readonly _config: TimeCycleConfig<T> = {
      name: "timeCycle",
      execute: null,
      filter: null,
      duration: 10e3,
      custom: { push: null }
    };

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
     * @description Выполняем this._execute
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

  /**
   * @author SNIPPIK
   * @description Интерфейс для опций TimeCycle
   * @private
   */
  interface TimeCycleConfig<T> {
    // Название цикла
    name: string;

    // Функция выполнения
    execute: (item: T) => void | Promise<boolean>;

    // Функция фильтрации
    filter: (item: T) => boolean;

    // Время через которое надо запустить цикл
    duration: number | "promise";

    // Модификации цикла, не обязательно
    custom?: {
      // Изменить логику добавления
      push?: (item: T) => void;

      // Изменить логику удаления
      remove?: (item: T) => void;
    };
  }
}


/**
 * @author SNIPPIK
 * @description Классы для взаимодействия с API
 * @namespace API
 * @public
 */
export namespace API {
  /**
   * @author SNIPPIK
   * @description Создаем класс запроса для взаимодействия с APIs
   * @class item
   * @abstract
   * @public
   */
  export abstract class item<T extends callbacks> {
    /**
     * @description Имя запроса на платформу
     */
    public readonly name: T;

    /**
     * @description Фильтр поиска при использовании поиска по типу
     */
    public readonly filter?: RegExp;

    /**
     * @description Выполняем запрос
     */
    public readonly callback?: (url: string, options: T extends "track" ? {audio?: boolean} : {limit?: number}) => callback<T>;

    /**
     * @description Создаем класс
     * @param options
     * @protected
     */
    protected constructor(options: item<T>) {
      Object.assign(this, options);
    };
  }

  /**
   * @author SNIPPIK
   * @description Получаем ответ от локальной базы APIs
   * @class response
   * @public
   */
  export class response {
    private readonly _api: request;
    /**
     * @description Выдаем название
     * @return API.platform
     * @public
     */
    public get platform() { return this._api.name; };

    /**
     * @description Выдаем bool, Недоступна ли платформа
     * @return boolean
     * @public
     */
    public get block() { return db.api.platforms.block.includes(this.platform); };

    /**
     * @description Выдаем bool, есть ли доступ к платформе
     * @return boolean
     * @public
     */
    public get auth() { return db.api.platforms.authorization.includes(this.platform); };

    /**
     * @description Выдаем int, цвет платформы
     * @return number
     * @public
     */
    public get color() { return this._api.color; };

    /**
     * @description Получаем функцию в зависимости от типа платформы и запроса
     * @param type {get} Тип запроса
     * @public
     */
    public get<T extends API.callbacks>(type: string | T): item<T> {
      const requests = this._api.requests;

      // Если указана ссылка
      if (type.startsWith("http")) {
        // Ищем класс поиска в платформе
        for (const item of requests) {
          if (item.name === type || item.filter && !!type.match(item.filter)) return item as item<T>;
        }

        return null;
      }

      // Скорее всего надо произвести поиск
      else {
        // Ищем класс поиска в платформе
        for (const item of requests) {
          if (item.name === "search" || item.name === type) return item as item<T>;
        }

        return null;
      }
    };

    /**
     * @description Ищем платформу из доступных
     * @param argument {API.platform} Имя платформы
     * @public
     */
    public constructor(argument: API.platform | string) {
      const temp = db.api.platforms.supported;

      //Если была указана ссылка
      if (argument.startsWith("http")) {
        const platform = temp.find((info) => !!argument.match(info.filter));

        //Если не найдена платформа тогда используем DISCORD
        if (!platform) { this._api = temp.find((info) => info.name === "DISCORD"); return; }
        this._api = platform; return;
      }

      //Если был указан текст
      try {
        const platform = temp.find((info) => info.name === argument);

        //Не найдена платформа тогда используем YOUTUBE
        if (!platform) { this._api = temp.find((info) => info.name === "YOUTUBE"); return; }

        this._api = platform;
      } catch { //Если произошла ошибка значит используем YOUTUBE
        this._api = temp.find((info) => info.name === "YOUTUBE");
      }
    };
  }

  /**
   * @author SNIPPIK
   * @description Создаем класс для итоговой платформы для взаимодействия с APIs
   * @interface request
   * @abstract
   * @public
   */
  export interface request {
    /**
     * @description Имя платформы
     * @readonly
     * @public
     */
    readonly name: platform;

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
    readonly requests: item<callbacks>[];
  }

  /**
   * @description Доступные платформы
   * @type platform
   * @public
   */
  export type platform = "YOUTUBE" | "SPOTIFY" | "VK" | "DISCORD" | "YANDEX";

  /**
   * @description Доступные запросы
   * @type callbacks
   * @public
   */
  export type callbacks = "track" | "playlist" | "search" | "album" | "author";

  /**
   * @description Функция запроса
   * @type callback<callbacks>
   * @public
   */
  export type callback<T> = Promise<(T extends "track" ? Track : T extends "playlist" | "album" ? Track.playlist : T extends "search" | "author" ? Track[] : never) | Error>
}