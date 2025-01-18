import type {LocalizationMap, Permissions} from "discord-api-types/v10";
import {CollectionAudioEvents, AudioPlayerEvents} from "@lib/player";
import {ClientEvents, ApplicationCommandOption} from "discord.js";
import {SlashComponent} from "@util/decorators/SlashCommand";
import {APIs} from "@service/db/services";
import {Client} from "@service/discord";
import {Interact} from "@util/discord";
import {Logger} from "@service/logger";
import {readdirSync} from "node:fs";

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
      const file = require(`../${path}`);

      // Удаляем кеш загрузки
      delete require.cache[require.resolve(path)];

      // Если нет импортируемых объектов
      if (!file?.default) return null;

      return file.default;
    } catch (error) {
      return error as Error;
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
     * @description Название событие
     * @default null
     * @readonly
     * @public
     */
    readonly name: T extends keyof CollectionAudioEvents ? keyof CollectionAudioEvents : T extends keyof AudioPlayerEvents ? keyof AudioPlayerEvents : keyof ClientEvents;

    /**
     * @description Тип события
     * @default null
     * @readonly
     * @public
     */
    readonly type: T extends keyof CollectionAudioEvents | keyof AudioPlayerEvents ? "player" : "client";

    /**
     * @description Тип выполнения события
     * @default null
     * @readonly
     * @public
     */
    readonly once: boolean;

    /**
     * @description Функция, которая будет запущена при вызове события
     * @default null
     * @readonly
     * @public
     */
    readonly execute: T extends keyof CollectionAudioEvents ? CollectionAudioEvents[T] : T extends keyof AudioPlayerEvents ? (...args: Parameters<AudioPlayerEvents[T]>) => void : T extends keyof ClientEvents ? (client: Client, ...args: ClientEvents[T]) => void : never;
  }

  /**
   * @author SNIPPIK
   * @description Интерфейс для команд
   * @interface Command
   * @public
   */
  export interface Command {
    /**
     * @description Название команды
     * @private
     */
    name?: string;

    /**
     * @description Переводы названия команды на другие языки
     * @private
     */
    name_localizations?: LocalizationMap;

    /**
     * @description Описание команды
     * @private
     */
    description?: string;

    /**
     * @description Описание команды на другие языки
     * @private
     */
    description_localizations?: LocalizationMap;

    /**
     * @description Можно ли использовать команду в личном текстовом канале
     * @private
     */
    dm_permission?: boolean;

    /**
     * @description Права на использование команды
     * @private
     */
    default_member_permissions?: Permissions | null | undefined;

    /**
     * @description 18+ доступ
     * @private
     */
    nsfw?: boolean;

    /**
     * @description Контексты установки, в которых доступна команда, только для команд с глобальной областью действия. По умолчанию используются настроенные контексты вашего приложения.
     * @public
     */
    readonly integration_types?: number[];

    /**
     * @description Контекст(ы) взаимодействия, в которых можно использовать команду, только для команд с глобальной областью действия. По умолчанию для новых команд включены все типы контекстов взаимодействия.
     * @private
     */
    readonly contexts?: number[];

    /**
     * @description Доп параметры для работы slashCommand
     * @private
     */
    readonly options?: ApplicationCommandOption[];

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
    readonly rules?: ("voice" | "queue" | "another_voice" | "player-not-playing")[]

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
      type: Command["options"][number]["name"];

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
}