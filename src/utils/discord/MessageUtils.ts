import {MessageSendOptions, ds_interact, MessageComponent, interact, SupportButtons} from "@type/discord";
import {CommandInteractionOption, GuildTextBasedChannel, User} from "discord.js"
import {Attachment, InteractionCallbackResponse} from "discord.js";
import type {Message, EmbedData, GuildMember} from "discord.js"
import {locale, languages} from "@service/locale";
import {EmbedBuilder} from "./EmbedBuilder";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Класс прослойка, для взаимодействия с discord.js
 * @class Interact2
 * @public
 */
export class Interact {
    /**
     * @description Оригинальный экземпляр discord.js message
     * @private
     */
    private readonly _message: interact;

    /**
     * @description Оригинальный экземпляр discord.js message
     * @public
     */
    public get message() {
        return this._message;
    };

    /**
     * @description Уникальный номер кнопки, указанный во фрагменте кода
     * @public
     */
    public get custom_id() {
        return this._message["customId"];
    };

    /**
     * @description Получаем опции взаимодействия пользователя с ботом
     * @public
     */
    public get options(): InteractOptions {
        return this._message["options"]
    };


    /**
     * @description Данные о текущем сервере
     * @public
     */
    public get guild() {
        return this._message.guild;
    };

    /**
     * @description Клиентский класс бота
     * @public
     */
    public get me() {
        return this._message.guild.members.me;
    };

    /**
     * @description Данные о текущем канале, данные параметр привязан к серверу
     * @public
     */
    public get channel() {
        return this._message.channel as GuildTextBasedChannel;
    };

    /**
     * @description Данные о текущем голосовом состоянии, данные параметр привязан к серверу
     * @public
     */
    public get voice() {
        return (this._message.member as GuildMember).voice;
    };

    /**
     * @description Данные о текущем пользователе или авторе сообщения
     * @public
     */
    public get author(): User {
        if ("author" in this._message) return this._message.author;
        return this._message.member.user as User;
    };

    /**
     * @description Данные о текущем пользователе сервера
     * @public
     */
    public get member() {
        return this._message.member;
    };


    /**
     * @description Проверяем возможно ли редактирование сообщения
     * @public
     */
    public get editable() {
        return this._message["editable"];
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Ответил ли бот пользователю?
     */
    public get replied() {
        return  this._message["replied"];
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Можно ли ответить на другое сообщение?
     */
    public get deferred() {
        return this._message["deferred"];
    };

    /**
     * @description Тип допустимого сообщения, какой тип сообщения можно использовать
     * @public
     */
    public get type() {
        // Если бот уже ответил на сообщение
        if (this.replied && !this.deferred) return "followUp";

        // Если можно просто отредактировать сообщение
        else if (this.deferred && !this.replied) return "editReply";

        // Если можно дать ответ на сообщение
        else if (!this.deferred && !this.replied) return "reply";

        // Если нельзя отправить ответ
        return "send";
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
    public set FBuilder(embed: EmbedData) {
        new this.builder().addEmbeds([embed]).setTime(10e3).send = this;
    };


    /**
     * @description Получаем команду из названия если нет названия команда не будет получена
     * @public
     */
    public get command() {
        if ("commandName" in this._message) return db.commands.get([this._message.commandName as string, this.options._group]);
        return null;
    };

    /**
     * @description Получение языка пользователя
     * @public
     */
    public get locale(): languages {
        if ("locale" in this._message) return this._message.locale as languages;
        else if ("guildLocale" in this._message) return this._message.guildLocale as languages;
        return locale.language;
    };

    /**
     * @description Получаем очередь сервера если она есть
     * @public
     */
    public get queue() {
        return db.queues.get(this.guild.id);
    };

    /**
     * @description Загружаем данные для взаимодействия с классом
     * @param data - Message или BaseInteraction
     */
    public constructor(data: ds_interact) {
        if (data instanceof InteractionCallbackResponse) this._message = data.resource.message;
        else this._message = data;
    };

    /**
     * @description Отправляем сообщение со соответствием параметров
     * @param options - Данные для отправки сообщения
     */
    public send = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
        const type = this.type;

        if (type === "send") return this._message.channel[type](options);
        return this._message[type](options);
    };

    /**
     * @description Редактируем сообщение
     * @param options - Данные для замены сообщения
     */
    public edit = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
        // Редактируем ответ
        if (this.deferred && !this.replied) return this._message["editReply"](options);

        // Редактируем обычное сообщение
        return this._message["edit"](options);
    };
}

/**
 * @author SNIPPIK
 * @description
 */
interface InteractOptions {
    _group?: string;
    _subcommand?: string;
    _hoistedOptions: CommandInteractionOption[];
    getAttachment?: (name: string) => Attachment;
}



/**
 * @author SNIPPIK
 * @description Функции для БЕЗОПАСНОЙ работы с discord.js
 * @class MessageUtils
 */
export class MessageUtils {
    /**
     * @author SNIPPIK
     * @description Таймеры сообщений
     * @private
     * @static
     */
    private static readonly _timers: Map<string, NodeJS.Timeout> = new Map();

    /**
     * @author SNIPPIK
     * @description Если надо удалить сообщение через время
     * @param message - Сообщение которое надо удалить
     * @param time - Время удаления
     */
    public static deleteMessage = (message: Interact | {message: InteractionCallbackResponse | Message}, time: number = 15e3) => {
        const timer = setTimeout(() => {
            if (message.message instanceof InteractionCallbackResponse) {
                message.message.resource.message.delete().catch(() => null);
                this._timers.delete(message.message.resource.message.id);
                return;
            }
            else if ("delete" in message.message && typeof message.message.delete === "function") {
                message.message.delete().catch(() => null);
                this._timers.delete(message.message.id);
            }
        }, time);

        // Добавляем таймер с базу
        this._timers.set(message.message["id"] ?? message.message["resource"].message.id, timer);
    };

    /**
     * @author SNIPPIK
     * @description Если надо произвести отмену удаления сообщения
     * @param id - ID сообщения
     */
    public static deferDeleteMessage = (id: string) => {
        const timer = this._timers.get(id);

        // Если есть таймер
        if (timer) {
            clearTimeout(timer);
            this._timers.delete(id);
        }
    };

    /**
     * @author SNIPPIK
     * @description Создание одной кнопки в одной функции
     * @param options - Параметры для создания кнопки
     */
    public static createButton(options: creator_button | creator_button_env): MessageComponent {
        let button: MessageComponent = {
            type: 2,
            style: options.style ?? 2,
            disabled: options.disabled,
            custom_id: null,
        };


        // Если указан env
        if ("env" in options) return {...button,
            emoji: MessageUtils.checkIDComponent(`button.${options.env}`),
            custom_id: options.env
        }

        return {...button,
            emoji: options.emoji,
            custom_id: options.id
        }
    };

    /**
     * @author SNIPPIK
     * @description Делаем проверку id
     * @param name - Название параметра в env
     */
    public static checkIDComponent(name: string): MessageComponent["emoji"] {
        const id = env.get(name);
        const int = parseInt(id);

        if (isNaN(int)) return { name: `${id}` };
        return { id };
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для создания кнопки из env
 */
interface creator_button_env {
    style?: MessageComponent["style"];
    env: SupportButtons;
    disabled?: boolean;
}

/**
 * @author SNIPPIK
 * @description Параметры для создания кнопки
 */
interface creator_button {
    style?: MessageComponent["style"];
    emoji: MessageComponent["emoji"];
    disabled?: boolean;
    id: SupportButtons;
}