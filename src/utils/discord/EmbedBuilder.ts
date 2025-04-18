import {MessageComponents, MessageSendOptions} from "@type/discord";
import {InteractionCallbackResponse, MessageFlags} from "discord.js";
import {Interact, Logger, MessageUtils} from "@utils";
import type {EmbedData, Message} from "discord.js";

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
    private _ephemeral: boolean = false;

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
            .catch((error) => {
                // Если при отправке сообщения произошла ошибка связанная с авторизацией
                // Эта ошибка возникает когда сообщение невозможно отредактировать, именно reply
                if (`${error}`.match(/Invalid Webhook Token/)) {
                    Logger.log("ERROR", "[DiscordAPI]: Error webhook token, ignoring!");
                    return;
                }

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