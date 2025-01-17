import type { EmbedData, GuildMember} from "discord.js"
import {CommandInteractionOption, GuildTextBasedChannel, User} from "discord.js"
import { Attachment, InteractionCallbackResponse } from "discord.js";
import {EmbedBuilder, MessageSendOptions, ds_input} from "@util/discord";
import {locale, languages} from "@service/locale";
import {Logger} from "@service/logger";
import {db} from "@service/db";

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
  private readonly _temp: ds_input;

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
  public get me() { return this._temp.guild.members.me; }

  /**
   * @description Проверяем возможно ли редактирование сообщения
   * @public
   */
  public get editable() {
    if ("editable" in this._temp) return this._temp.editable;
    return false;
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
    // Удаляем сообщение через time время
    setTimeout(() => {
      // Если получаем возврат
      if (this._temp instanceof InteractionCallbackResponse) this._temp.resource.message.delete().catch(() => null);
      else if ("delete" in this._temp) this._temp.delete().catch(() => null);
      else if ("deleteReply" in this._temp) (this._temp as any).deleteReply().catch(() => null);
      return;
    }, time || 15e3);
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
  public get builder() { return EmbedBuilder; };

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
   * @description Получение языка пользователя
   * @public
   */
  public get locale(): languages {
    if ("locale" in this._temp) return this._temp.locale;
    else if ("guildLocale" in this._temp) return this._temp.guildLocale as any;
    return locale.language;
  };


  /**
   * @description Загружаем данные для взаимодействия с классом
   * @param data - Message или BaseInteraction
   */
  public constructor(data: ds_input) {
    if (data instanceof InteractionCallbackResponse) this._temp = data.resource.message;
    else this._temp = data;
  };

  /**
   * @description Отправляем сообщение со соответствием параметров
   * @param options - Данные для отправки сообщения
   */
  public send = (options: MessageSendOptions): Promise<InteractionCallbackResponse> => {
    // Ловим ошибки
    try {
      // Если можно дать ответ на сообщение
      if (this.replied) {
        this._replied = false;
        return this._temp["reply"]({...options, withResponse: true});
      }

      // Если нельзя отправить ответ
      return this._temp.channel["send"]({...options, withResponse: true});
    } catch (err) {
      // Если происходит ошибка
      Logger.log("ERROR", err as string);
      return this._temp.channel["send"]({...options, withResponse: true});
    }
  };

  /**
   * @description Редактируем сообщение
   * @param options - Данные для замены сообщения
   */
  public edit = (options: MessageSendOptions): Promise<InteractionCallbackResponse> => {
    try {
      if ("edit" in this._temp) return this._temp.edit(options as any) as any;
      return null;
    } catch (err) {
      // Если происходит ошибка
      Logger.log("ERROR", err as string);
      return null;
    }
  };
}