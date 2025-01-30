import {CommandInteractionOption, GuildTextBasedChannel, User} from "discord.js"
import {MessageSendOptions, ds_input, MessageComponent} from "@type/discord";
import {Attachment, InteractionCallbackResponse} from "discord.js";
import type {EmbedData, GuildMember, Message} from "discord.js"
import {locale, languages} from "@service/locale";
import {Logger, EmbedBuilder} from "@utils";
import {env} from "@handler";
import {db} from "@app";

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
    private readonly _temp: ds_input = null;

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
    public get me() {
        return this._temp.guild.members.me;
    };

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
     * @description Данные о текущем сервере
     * @public
     */
    public get guild() {
        return this._temp.guild;
    };

    /**
     * @description Данные о текущем канале, данные параметр привязан к серверу
     * @public
     */
    public get channel() {
        return this._temp.channel as GuildTextBasedChannel;
    };

    /**
     * @description Данные о текущем голосовом состоянии, данные параметр привязан к серверу
     * @public
     */
    public get voice() {
        return (this._temp.member as GuildMember).voice;
    };

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
    public get member() {
        return this._temp.member;
    };

    /**
     * @description Удаление сообщения через указанное время
     * @param time - Через сколько удалить сообщение
     */
    public set delete(time: number) {
        MessageUtils.delete(this._temp as any, time);
    };


    /**
     * @description Получаем очередь сервера если она конечно есть!
     * @public
     */
    public get queue() {
        return db.queues.get(this.guild.id);
    };

    /**
     * @description Выдаем класс для сборки сообщений
     * @public
     */
    public get builder() {
        return EmbedBuilder;
    };

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
        if ("locale" in this._temp) return this._temp.locale as any;
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
    public send = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
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
    public edit = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
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

/**
 * @author SNIPPIK
 * @description Функции для БЕЗОПАСНОЙ работы с discord.js
 * @class MessageUtils
 */
export class MessageUtils {
    /**
     * @description Функция безопасного удаления сообщения
     * @param msg
     * @param time
     */
    public static delete(msg: InteractionCallbackResponse | Message, time: number =  10e3) {
        setTimeout(() => {
            if (msg instanceof InteractionCallbackResponse) {
                msg.resource.message.delete().catch(() => null);
                return;
            }

            msg.delete().catch(() => null);
        }, time);
    };

    /**
     * @author SNIPPIK
     * @description Создание одной кнопки в одной функции
     * @param name - Название параметра в env
     * @param style - Тип стиля
     * @param disable - Кнопка доступна для нажатия
     */
    public static createButton_env(name: string, style: MessageComponent["style"] = 2, disable: boolean): MessageComponent {
        return { type: 2, emoji: MessageUtils.checkIDComponent(name), custom_id: name.split("button.")[1], style, disable }
    };

    /**
     * @author SNIPPIK
     * @description Создание одной кнопки в одной функции
     * @param emoji - Название параметра в env
     * @param id - Уникальный индикатор кнопки
     * @param style - Тип стиля
     * @param disable - Кнопка доступна для нажатия
     */
    public static createButton(emoji: MessageComponent["emoji"], id: string, style: MessageComponent["style"] = 2, disable: boolean): MessageComponent {
        return { type: 2, emoji, custom_id: id, style, disable }
    };

    /**
     * @author SNIPPIK
     * @description Делаем проверку id
     * @param name - Название параметра в env
     */
    public static checkIDComponent(name: string): MessageComponent["emoji"] {
        const id = env.get(name);
        const int = parseInt(id);

        if (isNaN(int)) return {id: `${id}`};
        else return {id: `${id}`};
    };
}