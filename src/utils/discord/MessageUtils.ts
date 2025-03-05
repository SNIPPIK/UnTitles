import {MessageSendOptions, ds_interact, MessageComponent, interact} from "@type/discord";
import {CommandInteractionOption, GuildTextBasedChannel, User} from "discord.js"
import {Attachment, InteractionCallbackResponse} from "discord.js";
import type {EmbedData, GuildMember, Message} from "discord.js"
import {locale, languages} from "@service/locale";
import {SupportButtons} from "@handler/queues";
import {EmbedBuilder} from "@utils";
import {env} from "@handler";
import {db} from "@app";

/**
 * @author SNIPPIK
 * @description Функции для БЕЗОПАСНОЙ работы с discord.js
 * @class MessageUtils
 */
export class MessageUtils {
    /**
     * @description Функция безопасного удаления сообщения
     * @param msg - Сообщение которое будет удалено
     * @param time - Время через которое будет удалено сообщение
     */
    public static delete(msg: InteractionCallbackResponse | Message | ds_interact, time: number =  10e3) {
        setTimeout(() => {
            if (msg instanceof InteractionCallbackResponse) {
                msg.resource.message.delete().catch(() => null);
                return;
            }
            else if ("delete" in msg && typeof msg.delete === "function") msg.delete().catch(() => null);
        }, time);
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
 * @description Взаимодействие с discord message
 * @class Interact
 * @public
 */
export class Interact {
    /**
     * @description Сообщение принятое с discord.js
     * @private
     */
    private readonly _temp: interact = null;

    /**
     * @description Параметр отвечает за ложный ответ, если не хочет работать reply, будет работать <channel>.send
     * @public
     */
    public _hookReply = false;

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
        return this._temp.member.user as User;
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
        MessageUtils.delete(this._temp, time);
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
        if ("locale" in this._temp) return this._temp.locale as languages;
        else if ("guildLocale" in this._temp) return this._temp.guildLocale as languages;
        return locale.language;
    };


    /**
     * @description Загружаем данные для взаимодействия с классом
     * @param data - Message или BaseInteraction
     */
    public constructor(data: ds_interact) {
        if (data instanceof InteractionCallbackResponse) this._temp = data.resource.message;
        else this._temp = data;
    };

    /**
     * @description Отправляем запрос discord, чтобы он подождал ответ бота
     * @public
     */
    public deferReply = () => {
        if ("deferReply" in this._temp && typeof this._temp.deferReply === "function") return this._temp.deferReply();
        return null;
    };

    /**
     * @description Отправляем сообщение со соответствием параметров
     * @param options - Данные для отправки сообщения
     */
    public send = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
        // Если бот уже ответил на сообщение
        if (this._temp["replied"]) {
            return this._temp["followUp"](options);
        }

        // Если можно просто отредактировать сообщение
        else if (this._temp["deferred"]) {
            return this._temp["editReply"](options);
        }

        // Если можно дать ответ на сообщение
        else if (!this._temp["replied"] || !this._temp["deferred"]) {
            return this._temp["reply"](options);
        }

        // Если нельзя отправить ответ
        return this._temp.channel["send"](options);
    };

    /**
     * @description Редактируем сообщение
     * @param options - Данные для замены сообщения
     */
    public edit = (options: MessageSendOptions): Promise<InteractionCallbackResponse | Message> => {
        // Редактируем ответ
        if (this._temp["deferred"]) return this._temp["editReply"](options);

        // Редактируем обычное сообщение
        return this._temp["edit"](options);
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