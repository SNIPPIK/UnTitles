import {MessageComponents, MessageSendOptions} from "@type/discord";
import {InteractionCallbackResponse} from "discord.js";
import type {EmbedData, Message} from "discord.js";
import {Interact, Logger, MessageUtils} from "@utils";

/**
 * @author SNIPPIK
 * @description создаем продуманное сообщение
 * @class EmbedBuilder
 */
export class EmbedBuilder {
    /**
     * @description Временная база данных с ComponentData или классом ActionRowBuilder в array
     * @readonly
     * @public
     */
    public readonly components: Array<MessageComponents> = [];

    /**
     * @description Временная база данных с embed json data в array
     * @readonly
     * @public
     */
    public readonly embeds: Array<EmbedData> = [];

    /**
     * @description Параметры для создания меню
     * @readonly
     * @private
     */
    private readonly _menu: {
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
    } = {
        pages: [],
        type: null,
        page: 0
    };

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
        const options = {embeds: this.embeds, components: this.components, withResponse: !!this.promise || !!this.callback};

        interaction.send(options)
            .then((message) => {
                // Если получить возврат не удалось, то ничего не делаем
                if (!message) return;

                // Удаляем сообщение через время если это возможно
                if (this.time !== 0) MessageUtils.delete(message, this.time);

                // Создаем меню если есть параметры для него
                if (this._menu.pages.length > 0) this.constructor_menu(message instanceof InteractionCallbackResponse ? message.resource.message : message);

                // Если надо выполнить действия после
                if (this.promise) this.promise(new Interact(message));
            })
            .catch((err) => {
                // Не даем запустить проверку повторно
                if (interaction._hookReply) return;

                // Если происходит ошибка при отправке сообщений
                // Эта ошибка возникает когда отправка сообщение превысило время ожидания
                if (`${err}`.match(/Unknown interaction|Interaction has already been acknowledged/)) {
                    interaction._hookReply = true;

                    setTimeout(() => {
                        this.send = interaction;
                        interaction._hookReply = false;
                    }, 200);

                    Logger.log("ERROR", "[DiscordAPI]: Error interaction, resend...");
                    return;
                }

                // Если при отправке сообщения произошла ошибка связанная с авторизацией
                // Эта ошибка возникает когда сообщение невозможно отредактировать, именно reply
                else if (`${err}`.match(/Invalid Webhook Token/)) {
                    Logger.log("ERROR", "[DiscordAPI]: Error webhook token, ignoring!");
                    return;
                }

                console.error(err);
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
     * @public
     */
    public setTime = (time: number) => {
        this.time = time;
        return this;
    };

    /**
     * @description Добавляем components в базу для дальнейшей отправки
     * @param data - Компоненты под сообщением
     * @public
     */
    public addComponents = (data: MessageSendOptions["components"]) => {
        Object.assign(this.components, data);
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
        // Добавляем кнопки для просмотра
        if (options.type === "table") {
            this.components.push(
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
            this.components.push(
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

        Object.assign(this._menu, options);
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
            time: 60e3, componentType: 2,
            filter: (click) => click.user.id !== msg.client.user.id
        });

        // Собираем кнопки на которые нажал пользователь
        collector.on("collect", (i) => {
            // Кнопка переключения на предыдущую страницу
            if (i.customId === "menu_back") {
                // Делаем перелистывание на последнею страницу
                if (page === 0) page = pages.length;
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

                this.callback(msg, pages, page, this.embeds[0], pages[page]);
                try { return msg.delete(); } catch { return; }
            }

            // Кнопка отмены
            else if (i.customId === "menu_cancel") {
                try { return msg.delete(); } catch { return; }
            }

            return this.callback(msg, pages, page, this.embeds[0]);
        });
    };
}