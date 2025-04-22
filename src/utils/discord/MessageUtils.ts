import {BaseInteraction, GuildTextBasedChannel, type User, type InteractOptions, MessageFlags, type MessageSendOptions, type MessageComponents, InteractionCallbackResponse, type Message, type EmbedData, type GuildMember } from "discord.js"
import {locale, languages} from "@service/locale";
import {SupportButtons} from "@handler/modals";
import {Logger} from "@utils";
import {env, db} from "@app";

/**
 * @author SNIPPIK
 * @description Класс прослойка, для взаимодействия с discord.js
 * @class Interact
 * @public
 */
export class Interact {
    /**
     * @description Оригинальный экземпляр discord.js message
     * @private
     */
    private readonly _message: Message | BaseInteraction;

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
    public constructor(data: Message | BaseInteraction | InteractionCallbackResponse) {
        if (data instanceof InteractionCallbackResponse) this._message = data.resource.message;
        else this._message = data;
    };

    /**
     * @description Отправляем ответ
     * @param options - Данные для отправки сообщения
     */
    public respond = (options: {name: string; value: string}[]): void => {
        if ("isAutocomplete" in this._message && this._message.isAutocomplete()) this._message.respond(options).catch(() => {});
        return null;
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
 * @description создаем продуманное сообщение
 * @class EmbedBuilder
 */
export class EmbedBuilder {
    /**
     * @description Временная база данных с embed json data в array
     * @readonly
     * @public
     */
    public _embeds: Array<EmbedData> = [];

    /**
     * @description Временная база данных с ComponentData или классом ActionRowBuilder в array
     * @readonly
     * @public
     */
    public _components: Array<MessageComponents>;

    /**
     * @description Параметр скрытного сообщения
     * @private
     */
    private _ephemeral: boolean;

    /**
     * @description Параметры для создания меню
     * @readonly
     * @private
     */
    private _menu: EmbedBuilderMenu;

    /**
     * @description Время жизни сообщения по умолчанию
     * @public
     */
    public time: number = 15e3;

    /**
     * @description Отправляем сообщение в текстовый канал
     * @param interaction
     * @public
     */
    public set send(interaction: Interact) {
        const options = {embeds: this._embeds, components: this._components, withResponse: !!this.promise || !!this.callback};

        // Если надо скрывать сообщение
        if (this._ephemeral) Object.assign(options, {flags: MessageFlags.Ephemeral});

        // Отправляем сообщение
        interaction.send(options)
            .then(async (message) => {
                // Если получить возврат не удалось, то ничего не делаем
                if (!message) return;

                // Создаем меню если есть параметры для него
                if (this._menu) this.constructor_menu(message instanceof InteractionCallbackResponse ? message.resource.message : message);

                // Если надо выполнить действия после
                if (this.promise) this.promise(new Interact(message));

                // Удаляем сообщение через время если это возможно
                if (this.time !== 0) MessageUtils.deleteMessage({message}, this.time);
            })
            .catch(async (error) => {
                // Если при отправке сообщения произошла ошибка связанная с авторизацией
                // Эта ошибка возникает когда сообщение невозможно отредактировать, именно reply
                if (`${error}`.match(/Invalid Webhook Token/)) {
                    Logger.log("ERROR", "[DiscordAPI]: Error webhook token, ignoring!");
                    return;
                }

                // Если по мнению discord'а что-то уже отправлено, хотя это не так
                else if (`${error}`.match(/(Unknown interaction)|(Interaction has already been acknowledged)/)) return;

                console.error(error);
            });
    };

    /**
     * @description Функция позволяющая бесконечно выполнять обновление сообщения
     * @public
     */
    private callback: (message: Message, pages: any[], page: number, embed: EmbedData, selected?: any) => void;

    /**
     * @description Функция которая будет выполнена после отправления сообщения
     * @public
     */
    private promise: (msg: Interact) => void;

    /**
     * @description Добавляем embeds в базу для дальнейшей отправки
     * @param data - MessageBuilder["configuration"]["embeds"]
     * @public
     */
    public addEmbeds = (data: EmbedData[]) => {
        Object.assign(this._embeds, data);

        for (let embed of this._embeds) {
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
     * @public
     */
    public setTime = (time: number) => {
        this.time = time;
        return this;
    };

    /**
     * @description Добавляем параметр скрытного сообщения
     * @public
     */
    public setEphemeral = () => {
        this._ephemeral = true;
        return this;
    };

    /**
     * @description Добавляем components в базу для дальнейшей отправки
     * @param data - Компоненты под сообщением
     * @public
     */
    public addComponents = (data: MessageSendOptions["components"]) => {
        if (!this._components) this._components = [];
        Object.assign(this._components, data);
        return this;
    };

    /**
     * @description Функция которая будет возвращена после отправки сообщения
     * @param func - Функция для выполнения после
     * @public
     */
    public setPromise = (func: EmbedBuilder["promise"]) => {
        this.promise = func;
        return this;
    };

    /**
     * @description Функция которая будет выполниться при вызове кнопки
     * @param func - Функция для выполнения после
     * @public
     */
    public setCallback = (func: EmbedBuilder["callback"]) => {
        this.callback = func;
        return this;
    };

    /**
     * @description Параметры для создания меню
     * @param options - Сами параметры
     * @public
     */
    public setMenu = (options: EmbedBuilder["_menu"]) => {
        if (!this._components) this._components = [];

        // Добавляем кнопки для просмотра
        if (options.type === "table") {
            this._components.push(
                {
                    type: 1, components: [
                        MessageUtils.createButton({emoji: {name: "⬅"},  id: "menu_back"}),
                        MessageUtils.createButton({emoji: {name: "➡"},  id: "menu_next"}),//{name: "➡"},  "menu_next", 2, false),
                        MessageUtils.createButton({emoji: {name: "🗑️"}, id: "menu_cancel", style: 4}),//{name: "🗑️"}, "menu_cancel", 4, false)
                    ]
                }
            )
        }

        // Добавляем кнопки для выбора
        else {
            this._components.push(
                {
                    type: 1, components: [
                        MessageUtils.createButton({emoji: {name: "⬅"},  id: "menu_back"}),
                        MessageUtils.createButton({emoji: {name: "✔️"}, id: "menu_select", style: 3}),
                        MessageUtils.createButton({emoji: {name: "➡"},  id: "menu_next"}),
                        MessageUtils.createButton({emoji: {name: "🗑️"}, id: "menu_cancel", style: 4})
                    ]
                }
            )
        }

        this._menu = options;
        return this;
    };

    /**
     * @description Создаем интерактивное меню
     * @param msg      - Сообщение от сообщения
     * @private
     */
    private constructor_menu = (msg: Message) => {
        let {pages, page} = this._menu;

        // Создаем сборщик
        const collector = msg.createMessageComponentCollector({
            time: 120e3, componentType: 2,
            filter: (click) => click.user.id !== msg.client.user.id
        });

        // Собираем кнопки на которые нажал пользователь
        collector.on("collect", (i) => {
            // Кнопка переключения на предыдущую страницу
            if (i.customId === "menu_back") {
                // Делаем перелистывание на последнею страницу
                if (page === 0) page = pages.length - 1;
                else if (pages.length === 1) return;
                else page--;
            }

            // Кнопка переключения на предыдущую страницу
            else if (i.customId === "menu_next") {
                // Делаем перелистывание на первую страницу
                if (page === pages.length) page = 0;
                else if (pages.length === 1) return;
                else page++;
            }

            // Добавляем выбранный трек
            else if (i.customId === "menu_select") {
                if (pages.length === 1) return;

                this.callback(msg, pages, page, this._embeds[0], pages[page]);
                try { return msg.delete(); } catch { return; }
            }

            // Кнопка отмены
            else if (i.customId === "menu_cancel") {
                try { return msg.delete(); } catch { return; }
            }

            return this.callback(msg, pages, page, this._embeds[0]);
        });
    };
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
        const timer = setTimeout(async () => {
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

/**
 * @author SNIPPIK
 * @description Компонент одной кнопки
 * @type MessageComponent
 */
export type MessageComponent = MessageComponents["components"][number];

/**
 * @author SNIPPIK
 * @description Параметры для создания меню с кнопками
 * @interface EmbedBuilderMenu
 */
interface EmbedBuilderMenu {
    /**
     * @description Сами страницы
     */
    pages: any[];

    /**
     * @description Тип взаимодействия
     */
    type: "table" | "selector";

    /**
     * @description Номер текущей страницы
     */
    page: number;
}