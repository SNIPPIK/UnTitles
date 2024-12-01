import {CommandInteractionOption, GuildTextBasedChannel, ActionRowBuilder, User, Colors} from "discord.js"
import type { ComponentData, EmbedData, GuildMember} from "discord.js"
import { BaseInteraction, Message, Attachment} from "discord.js";
import type {LocalizationMap} from "discord-api-types/v10";
import {locale} from "@lib/locale";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Функции правил проверки, возвращает true или false
 * @true - Разрешено
 * @false - Запрещено
 */
const intends: {[key: string]: (message: Interact) => boolean } = {
  "voice": (message) => {
    const VoiceChannel = message.voice.channel;

    // Если нет голосового подключения
    if (!VoiceChannel) {
      message.fastBuilder = { description: locale._(message.locale, "voice.need", [message.author]), color: Colors.Yellow };
      return false;
    }

    return true;
  },
  "queue": (message) => {
    // Если нет очереди
    if (!message.queue) {
      message.fastBuilder = { description: locale._(message.locale, "queue.need", [message.author]), color: Colors.Yellow };
      return false;
    }

    return true;
  },
  "another_voice": (message) => {
    const queue = message.queue;
    const VoiceChannel = (message.member as GuildMember)?.voice?.channel;

    // Если музыка играет в другом голосовом канале
    if (message.guild.members.me?.voice?.channel?.id !== VoiceChannel.id) {

      // Если включена музыка на сервере
      if (queue) {

        // Если есть голосовое подключение
        if (queue.voice && queue.voice.channel) {

          // Если в гс есть другие пользователи
          if (queue.voice.channel?.members?.size > 1) {
            message.fastBuilder = { description: locale._(message.locale, "voice.alt", [message.voice.channel]), color: Colors.Yellow };
            return false;
          }

          // Если нет пользователей, то подключаемся к другому пользователю
          else {
            queue.voice = message.voice;
            queue.message = message;
            message.fastBuilder = { description: locale._(message.locale, "voice.new", [message.voice.channel]), color: Colors.Yellow };
            return true;
          }
        }
      }

      // Если нет очереди, но есть голосовое подключение
      else {
        const connection = db.voice.get(message.guild.id);

        // Отключаемся от голосового канала
        if (connection) connection.disconnect();
      }
    }

    return true;
  }
};

/**
 * @author SNIPPIK
 * @description Поддерживаемые правила проверки
 */
export type InteractRules = "voice" | "queue" | "another_voice";

/**
 * @author SNIPPIK
 * @description Класс для проверки, используется в командах
 * @class InteractRule
 * @public
 */
export class InteractRule {
  /**
   * @description Проверяем команды на наличие
   * @param array
   * @param message
   */
  public static check = (array: InteractRules[], message: Interact) => {
    if (!array || array?.length === 0) return false;

    let onError = true;

    // Проверяем всю базу
    for (const key of array) {
      const intent = intends[key];

      //Если нет этого необходимости проверки запроса, то пропускаем
      if (!intent) continue;
      else onError = intent(message);
    }

    return onError;
  };
}


/**
 * @author SNIPPIK
 * @description Взаимодействие с discord message
 * @class Interact
 * @public
 */
export class Interact {
  /**
   * @description Сообщение принятое с discord.js
   * @private
   */
  private readonly _temp: Message | BaseInteraction;

  /**
   * @description Не был получен ответ
   * @private
   */
  private _replied: boolean = true;

  /**
   * @description Уникальный номер кнопки
   * @public
   */
  public get custom_id(): string {
    if ("customId" in this._temp) return this._temp.customId as string;
    return null;
  };

  /**
   * @description Главный класс бота
   * @public
   */
  public get me() { return this._temp.client; }

  /**
   * @description Проверяем возможно ли редактирование сообщения
   * @public
   */
  public get editable() {
    if ("editable" in this._temp) return this._temp.editable;
    return false;
  };

  /**
   * @description Получение языка пользователя
   * @public
   */
  public get locale(): keyof LocalizationMap {
    if ("locale" in this._temp) return this._temp.locale;
    else if ("guildLocale" in this._temp) return this._temp.guildLocale as any;
    return "ru";
  };

  /**
   * @description Получен ли ответ на сообщение
   * @public
   */
  public get replied() { return this._replied; };

  /**
   * @description Получаем опции взаимодействия пользователя с ботом
   * @public
   */
  public get options(): { _group?: string; _subcommand?: string; _hoistedOptions: CommandInteractionOption[]; getAttachment?: (name: string) => Attachment } {
    if ("options" in this._temp) return this._temp.options as any;
    return null;
  };

  /**
   * @description Получаем очередь сервера если она конечно есть!
   * @public
   */
  public get queue() { return db.audio.queue.get(this.guild.id); };

  /**
   * @description Выдаем класс для сборки сообщений
   * @public
   */
  public get builder() { return MessageBuilder; };

  /**
   * @description Отправляем быстрое сообщение
   * @param embed - Embed data, для создания сообщения
   */
  public set fastBuilder(embed: EmbedData) {
    new this.builder().addEmbeds([embed]).setTime(10e3).send = this;
  };

  /**
   * @description Получаем команду из названия если нет названия команда не будет получена
   * @public
   */
  public get command() {
    if ("commandName" in this._temp) return db.commands.get([this._temp.commandName as string, this.options._group]);
    return null;
  };



  /**
   * @description Данные о текущем сервере
   * @public
   */
  public get guild() { return this._temp.guild; };

  /**
   * @description Данные о текущем канале, данные параметр привязан к серверу
   * @public
   */
  public get channel() { return this._temp.channel as GuildTextBasedChannel; };

  /**
   * @description Данные о текущем голосовом состоянии, данные параметр привязан к серверу
   * @public
   */
  public get voice() { return (this._temp.member as GuildMember).voice; };

  /**
   * @description Данные о текущем пользователе или авторе сообщения
   * @public
   */
  public get author(): User {
    if ("author" in this._temp) return this._temp.author;
    return this._temp.member.user as any;
  };

  /**
   * @description Данные о текущем пользователе сервера
   * @public
   */
  public get member() { return this._temp.member; };


  /**
   * @description Удаление сообщения через указанное время
   * @param time - Через сколько удалить сообщение
   */
  public set delete(time: number) {
    //Удаляем сообщение через time время
    setTimeout(() => {
      if (this.replied && "deleteReply" in this._temp) (this._temp as any).deleteReply();
      else (this._temp as any).delete();
    }, time || 15e3);
  };

  /**
   * @description Загружаем данные для взаимодействия с классом
   * @param data - Message или BaseInteraction
   */
  public constructor(data: Message | BaseInteraction) {
    this._temp = data;
  };

  /**
   * @description Отправляем сообщение со соответствием параметров
   * @param options - Данные для отправки сообщения
   */
  public send = (options: {embeds?: EmbedData[], components?: (ComponentData | ActionRowBuilder)[]}): Promise<Message> => {
    try {
      if (this.replied) {
        this._replied = false;
        return this._temp["reply"]({...options, fetchReply: true});
      }

      return this._temp.channel["send"]({...options, fetchReply: true});
    } catch {
      return this._temp.channel["send"]({...options, fetchReply: true});
    }
  };

  /**
   * @description Редактируем сообщение
   * @param options - Данные для замены сообщения
   */
  public edit = (options: {embeds?: EmbedData[], components?: (ComponentData | ActionRowBuilder)[]}) => {
    if ("edit" in this._temp) return this._temp.edit(options as any);
    return null;
  };
}


/**
 * @author SNIPPIK
 * @description создаем продуманное сообщение
 * @class MessageBuilder
 */
class MessageBuilder {
  /**
   * @description Временная база данных с embed json data в array
   * @public
   */
  public readonly embeds: (EmbedData)[] = [];

  /**
   * @description Временная база данных с ComponentData или классом ActionRowBuilder в array
   * @public
   */
  public readonly components: (ComponentData | ActionRowBuilder)[] = [];

  /**
   * @description Время жизни сообщения по умолчанию
   * @public
   */
  public time: number = 15e3;

  public page: number = 1;
  public pages: string[] = [];

  /**
   * @description Отправляем сообщение в текстовый канал
   * @param interaction
   */
  public set send(interaction: Interact) {
    interaction.send({embeds: this.embeds, components: this.components})
        .then((message) => {
          //Если получить возврат не удалось, то ничего не делаем
          if (!message) return;

          const msg = new Interact(message);

          //Удаляем сообщение через время если это возможно
          if (this.time !== 0) msg.delete = this.time;

          //Если меню, то не надо удалять
          if (this.pages && this.pages.length > 1) this.createMenuTable(message);

          //Если надо выполнить действия после
          if (this.promise) this.promise(msg);
        });
  };

  /**
   * @description Функция позволяющая бесконечно выполнять обновление сообщения
   * @public
   */
  public callback: (message: Message, pages: string[], page: number, embed: MessageBuilder["embeds"]) => void;

  /**
   * @description Функция которая будет выполнена после отправления сообщения
   * @public
   */
  public promise: (msg: Interact) => void;

  /**
   * @description Добавляем embeds в базу для дальнейшей отправки
   * @param data - MessageBuilder["configuration"]["embeds"]
   */
  public addEmbeds = (data: MessageBuilder["embeds"]) => {
    Object.assign(this.embeds, data);

    for (let embed of this.embeds) {
      // Добавляем цвет по-умолчанию
      if (!embed.color) embed.color = 258044;

      // Исправляем fields, ну мало ли
      if (embed.fields?.length > 0) embed.fields = embed.fields.filter((item) => !!item);
    }

    return this;
  };

  /**
   * @description Добавляем время удаления сообщения
   * @param time - Время в миллисекундах
   */
  public setTime = (time: number) => {
    this.time = time;
    return this;
  };

  /**
   * @description Добавляем components в базу для дальнейшей отправки
   * @param data - Компоненты под сообщением
   */
  public addComponents = (data: MessageBuilder["components"]) => {
    Object.assign(this.components, data);
    return this;
  };

  /**
   * @description Добавляем функцию для управления данными после отправки
   * @param func - Функция для выполнения после
   */
  public setPromise = (func: MessageBuilder["promise"]) => {
    this.promise = func;
    return this;
  };

  /**
   * @description Добавляем функцию для управления данными после отправки, для menu
   * @param func - Функция для выполнения после
   */
  public setCallback = (func: MessageBuilder["callback"]) => {
    this.callback = func;
    return this;
  };

  /**
   * @description Добавляем pages в базу для дальнейшей обработки
   * @param list - Список данных для обновления
   */
  public setPages = (list: string[]) => {
    this.pages = list;

    // Добавляем кнопки
    if (this.pages && this.pages.length > 1) this.components.push(
        {
          type: 1, components: [// @ts-ignore
            {type: 2, emoji: {name: "⬅"}, custom_id: "back", style: 2},// @ts-ignore
            {type: 2, emoji: {name: "➡"}, custom_id: "next", style: 2},// @ts-ignore
            {type: 2, emoji: {name: "🗑️"}, custom_id: "cancel", style: 4}
          ]
        }
    )

    return this;
  };

  /**
   * @description Задаем страницу по умолчанию, с нее будет начат отсчет
   * @param page - Номер страницы
   */
  public setPage = (page: number) => {
    this.page = page;

    return this;
  };

  /**
   * @description Создаем меню с объектами
   * @param msg - Сообщение пользователя
   * @return void
   */
  private createMenuTable = (msg: Message) => {
    const pages = this.pages;
    let page = this.page;

    // Создаем сборщик
    const collector = msg.createMessageComponentCollector({
      time: 60e3, componentType: 2,
      filter: (click) => click.user.id !== msg.client.user.id
    });

    // Собираем кнопки на которые нажал пользователь
    collector.on("collect", (i) => {
      // Игнорируем ошибки
      try { i.deferReply(); i.deleteReply(); } catch {}

      // Если нельзя поменять страницу
      if (page === pages.length || page < 0) return;

      // Кнопка переключения на предыдущую страницу
      if (i.customId === "back") page--;
      // Кнопка переключения на следующую страницу
      else if (i.customId === "next") page++;
      // Кнопка отмены и удаления сообщения
      else if (i.customId === "cancel") {
        msg.delete();
        return;
      }

      return this.callback(msg as any, pages, page, this.embeds);
    });
  };
}