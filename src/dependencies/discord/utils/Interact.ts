import {CommandInteractionOption, GuildTextBasedChannel, ActionRowBuilder, User} from "discord.js"
import type { ComponentData, EmbedData, GuildMember} from "discord.js"
import { BaseInteraction, Message, Attachment, MessageFlags} from "discord.js";
import {locale, languages} from "@lib/locale";
import {db} from "@lib/db";

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
  public get locale(): languages {
    if ("locale" in this._temp) return this._temp.locale;
    else if ("guildLocale" in this._temp) return this._temp.guildLocale as any;
    return locale.language;
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
    // Удаляем сообщение через time время
    setTimeout(() => {
      try {
        if (this.replied && "deleteReply" in this._temp) (this._temp as any).deleteReply().catch(() => null);
        else (this._temp as any).delete().catch(() => null);
      } catch {/* Ohh discord.js */}
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
  public send = (options: {content?: string, embeds?: EmbedData[], components?: (ComponentData | ActionRowBuilder)[], flags?: MessageFlags}): Promise<Message> => {
    try {
      if (this.replied) {
        this._replied = false;
        return this._temp["reply"]({...options, withResponse: true});
      }

      return this._temp.channel["send"]({...options, withResponse: true});
    } catch {
      return this._temp.channel["send"]({...options, withResponse: true});
    }
  };

  /**
   * @description Редактируем сообщение
   * @param options - Данные для замены сообщения
   */
  public edit = (options: {content?: string, embeds?: EmbedData[], components?: (ComponentData | ActionRowBuilder)[], flags?: MessageFlags}) => {
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
   * @description Скрывать ли сообщение от глаз других пользователей
   * @private
   */
  private flags: MessageFlags = null;

  /**
   * @description Параметры для создания меню
   * @private
   */
  private readonly _menu = {
    pages: [] as any[],
    type: null as "table" | "selector",
    page: 0
  };

  /**
   * @description Функция позволяющая бесконечно выполнять обновление сообщения
   * @public
   */
  private callback: (message: Message, pages: any[], page: number, embed: MessageBuilder["embeds"], selected?: any) => void;

  /**
   * @description Функция которая будет выполнена после отправления сообщения
   * @public
   */
  private promise: (msg: Interact) => void;

  /**
   * @description Время жизни сообщения по умолчанию
   * @public
   */
  public time: number = 15e3;

  /**
   * @description Отправляем сообщение в текстовый канал
   * @param interaction
   */
  public set send(interaction: Interact) {
    interaction.send({embeds: this.embeds, components: this.components, flags: this.flags})
        .then((message) => {
          // Если получить возврат не удалось, то ничего не делаем
          if (!message) return;

          const msg = new Interact(message);

          // Удаляем сообщение через время если это возможно
          if (this.time !== 0) msg.delete = this.time;

          // Создаем меню если есть параметры для него
          if (this._menu.pages.length > 0) this.constructor_menu(message);

          // Если надо выполнить действия после
          if (this.promise) this.promise(msg);
        });
  };

  /**
   * @description Спрятать ли это сообщение от чужих глаз
   * @param bool - Тип
   */
  public setHide = (bool: boolean) => {
    if (bool) this.flags = MessageFlags.Ephemeral;
    return this;
  };

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
   * @param time - Время в миллисекундах, если указать 0 то сообщение не будет удалено
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
   * @description Параметры для создания меню
   * @param options - Сами параметры
   */
  public setMenu = (options: MessageBuilder["_menu"]) => {
    // Добавляем кнопки для просмотра
    if (options.type === "table") {
      this.components.push(
          {
            type: 1, components: [// @ts-ignore
              {type: 2, emoji: {name: "⬅"}, custom_id: "menu_back", style: 2},   // @ts-ignore
              {type: 2, emoji: {name: "➡"}, custom_id: "menu_next", style: 2},   // @ts-ignore
              {type: 2, emoji: {name: "🗑️"}, custom_id: "menu_cancel", style: 4}
            ]
          }
      )
    }

    // Добавляем кнопки для выбора
    else {
      this.components.push(
          {
            type: 1, components: [// @ts-ignore
              {type: 2, emoji: {name: "⬅"}, custom_id: "menu_back", style: 2},    // @ts-ignore
              {type: 2, emoji: {name: "✔️"}, custom_id: "menu_select", style: 3}, // @ts-ignore
              {type: 2, emoji: {name: "➡"}, custom_id: "menu_next", style: 2},    // @ts-ignore
              {type: 2, emoji: {name: "🗑️"}, custom_id: "menu_cancel", style: 4}
            ]
          }
      )
    }

    Object.assign(this._menu, options);
    return this;
  };

  /**
   * @description Создаем интерактивное меню
   * @param msg      - Сообщение от сообщения
   */
  private constructor_menu = (msg: Message) => {
    let {pages, page} = this._menu;

    // Создаем сборщик
    const collector = msg.createMessageComponentCollector({
      time: 60e3, componentType: 2,
      filter: (click) => click.user.id !== msg.client.user.id
    });

    // Собираем кнопки на которые нажал пользователь
    collector.on("collect", (i) => {
      // Игнорируем ошибки
      try { i.deferReply(); i.deleteReply(); } catch {}

      // Правит ситуацию когда пользователь включает не тот трек который надо
      const temple_page = page + 1;

      // Делаем стрелки более функциональными
      if (temple_page === pages.length) page = 0;
      else if (temple_page < 0) page = pages.length;

      // Кнопка переключения на предыдущую страницу
      if (i.customId === "menu_back") page--;

      // Кнопка переключения на следующую страницу
      else if (i.customId === "menu_next") page++;

      // Добавляем выбранный трек
      else if (i.customId === "menu_select") {
        this.callback(msg, pages, page, this.embeds, pages[page]);
        try { msg.delete(); } catch { return; }
        return;
      }

      // Кнопка отмены
      else if (i.customId === "menu_cancel") {
        try { msg.delete(); } catch { return; }
        return;
      }

      return this.callback(msg, pages, page, this.embeds);
    });
  };
}