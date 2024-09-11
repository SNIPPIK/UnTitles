import type {ComponentData, EmbedData, GuildMember, CommandInteractionOption, GuildTextBasedChannel} from "discord.js"
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
  public get replied() {
    if ("replied" in this._temp) return this._temp.replied;
    return this._replied;
  };

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
  public get author() {
    if ("author" in this._temp) return this._temp.author;
    return this._temp.member;
  };

  /**
   * @description Данные о текущем пользователе сервера
   * @public
   */
  public get member() { return this._temp.member; };



  /**
   * @description Получаем команду из названия если нет названия команда не будет получена
   * @public
   */
  public get command() { //@ts-ignore
    if ("commandName" in this._temp) return db.commands.get([this._temp.commandName, this.options._group]);
    return null;
  };

  /**
   * @description Отправляем сообщение со соответствием параметров
   * @param options - Данные для отправки сообщения
   */
  public set send(options: {embeds?: EmbedData[], components?: ComponentData[]}) {
    if (!this.replied) {
      //@ts-ignore
      if (!this._temp.deferred) this._temp.reply({...options, fetchReply: true });
      //@ts-ignore
      else this._temp.followUp({...options, fetchReply: true });
      return;
    }

    //@ts-ignore
    this._temp.channel.send({...options, fetchReply: true });
  };

  /**
   * @description Удаление сообщения через указанное время
   * @param time - Через сколько удалить сообщение
   */
  public set delete(time: number) {
    //Удаляем сообщение через time время
    setTimeout(() => {
      if (this.replied) (this._temp as any).deleteReply();
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
}