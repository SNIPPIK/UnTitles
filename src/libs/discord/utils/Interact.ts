import {
  ComponentData,
  EmbedData,
  GuildMember,
  CommandInteractionOption,
  GuildTextBasedChannel,
  ActionRowBuilder, User, InteractionResponse
} from "discord.js"
import { BaseInteraction, Message, Attachment} from "discord.js";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с discord message
 * @class Interact
 */
export class Interact {
  private readonly _temp: Message | BaseInteraction;
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

  public get locale() {
    if ("locale" in this._temp) return this._temp.locale;
    return "ru";
  }

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
   * @description Получаем команду из названия если нет названия команда не будет получена
   * @public
   */
  public get command() { //@ts-ignore
    if ("commandName" in this._temp) return db.commands.get([this._temp.commandName, this.options._group]);
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
  public send = async (options: {embeds?: EmbedData[], components?: (ComponentData | ActionRowBuilder)[]}): Promise<Message> => {
    try {
      if (this.replied) {
        this._replied = false;
        return this._temp["reply"]({...options, fetchReply: true});
      } else await this._temp["deferReply"]();

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
export class MessageBuilder {
  public callback: (message: Message, pages: string[], page: number, embed: MessageBuilder["embeds"]) => void;
  public promise: (msg: Interact) => void;
  public components: (ComponentData | ActionRowBuilder)[] = [];
  public embeds: (EmbedData)[] = [];
  public time: number = 15e3;

  /**
   * @description Отправляем сообщение в текстовый канал
   * @param interaction
   */
  public set send(interaction: Interact) {
    interaction.send({embeds: this.embeds, components: this.components}).then((message) => {
      //Если получить возврат не удалось, то ничего не делаем
      if (!message) return;

      const msg = new Interact(message);

      //Удаляем сообщение через время если это возможно
      if (this.time !== 0) msg.delete = this.time;

      //Если надо выполнить действия после
      if (this.promise) this.promise(msg);
    });
  };

  /**
   * @description Добавляем embeds в базу для дальнейшей отправки
   * @param data - MessageBuilder["configuration"]["embeds"]
   */
  public addEmbeds = (data: MessageBuilder["embeds"]) => {
    Object.assign(this.embeds, data);

    for (let embed of this.embeds) {
      //Добавляем цвет по-умолчанию
      if (!embed.color) embed.color = 258044;

      //Исправляем fields, ну мало ли
      if (embed.fields?.length > 0) {
        for (const field of embed.fields) {
          if (field === null) embed.fields = embed.fields.toSpliced(embed.fields.indexOf(field), 1);
        }
      }
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
   * @description Добавляем сomponents в базу для дальнейшей отправки
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
}