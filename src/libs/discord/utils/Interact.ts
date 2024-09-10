import type { BaseInteraction, Message, GuildTextBasedChannel, EmbedData } from "discord.js";
import {db} from "@lib/db";

/**
 * @author SNIPPIK
 * @description Взаимодействие с discord message
 * @class Interact
 */
export class Interact {
  private readonly _temp: Message | BaseInteraction;

  /**
   * @description Загружаем данные для взаимодействия с классом
   * @param data - Message или BaseInteraction
   */
  public constructor(data: Message | BaseInteraction) {
    this._temp = data;
  };

  /**
   * @description Данные о текущем сервере
   * @public
   */
  public get guild() { return this._temp.guild; };

  /**
   * @description Данные о текущем сервере
   * @public
   */
  public get channel() { return this._temp.channel as GuildTextBasedChannel; };

  /**
   * @description Данные о текущем пользователе
   * @public
   */
  public get author() {
    if ("author" in this._temp) return this._temp.author;
    return this._temp.member;
  };

  /**
   * @description Данные о текущем пользователе
   * @public
   */
  public get member() { return this._temp.member; };

  /**
   * @description Получаем команду
   * @public
   */
  public get command() {
    if ("commandName" in this._temp) {       //@ts-ignore
      return db.commands.get([this._temp.commandName]);
    }
  };

  /**
   * @description Отправляем сообщение
   * @param options - Данные для отправки сообщения
   */
  public set send(options: Interact_sendMessage) {
    try {
      if ( "replied" in this._temp && !(this._temp as any).replied && !this._temp.replied ) {
        //@ts-ignore
        if (!this._temp.deferred) this._temp.reply({...options, fetchReply: true });
        //@ts-ignore
        else this._temp.followUp({...options, fetchReply: true });
        return;
      }
    } catch {
      /*Значит отправляем другое сообщение*/
    }

    //@ts-ignore
    this._temp.channel.send({...options, fetchReply: true });
  };
}

interface Interact_sendMessage {
  embeds: EmbedData[];
}
