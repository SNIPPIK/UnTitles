import {ActionRowBuilder, InteractionCallbackResponse} from "discord.js"
import type { ComponentData, EmbedData} from "discord.js"
import { Message, MessageFlags } from "discord.js";
import { Interact} from "@util/discord";

/**
 * @author SNIPPIK
 * @description создаем продуманное сообщение
 * @class EmbedBuilder
 */
export class EmbedBuilder<T extends Interact> {
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
    private callback: (message: Message, pages: any[], page: number, embed: EmbedData, selected?: any) => void;

    /**
     * @description Функция которая будет выполнена после отправления сообщения
     * @public
     */
    private promise: (msg: T) => void;

    /**
     * @description Время жизни сообщения по умолчанию
     * @public
     */
    public time: number = 15e3;

    /**
     * @description Отправляем сообщение в текстовый канал
     * @param interaction
     */
    public set send(interaction: T) {
        const options = {embeds: this.embeds, components: this.components, flags: this.flags};

        interaction.send({embeds: this.embeds, components: this.components, flags: this.flags})
            .then((message: InteractionCallbackResponse) => {
                // Если получить возврат не удалось, то ничего не делаем
                if (!message) return;

                const msg = new Interact(message as any);

                // Удаляем сообщение через время если это возможно
                if (this.time !== 0) msg.delete = this.time;

                // Создаем меню если есть параметры для него
                if (this._menu.pages.length > 0) this.constructor_menu(message.resource.message);

                // Если надо выполнить действия после
                if (this.promise) this.promise(msg as any);
            });

        /*
        if (interaction instanceof Message) {
            MessageUtils.send(interaction.channel, options)
                .then(async (message) => {
                    // Если получить возврат не удалось, то ничего не делаем
                    if (!message) return;

                    // Удаляем сообщение через время если это возможно
                    if (this.time !== 0) await MessageUtils.delete(message, this.time);

                    // Создаем меню если есть параметры для него
                    if (this._menu.pages.length > 0) this.constructor_menu(message);

                    // Если надо выполнить действия после
                    if (this.promise) this.promise(message as any);
                });
        }

        else {
            InteractionUtils.send(interaction as any, options)
                .then(async (message) => {
                    // Если получить возврат не удалось, то ничего не делаем
                    if (!message) return;

                    // Удаляем сообщение через время если это возможно
                    if (this.time !== 0) await MessageUtils.delete(message.resource.message, this.time);

                    // Создаем меню если есть параметры для него
                    if (this._menu.pages.length > 0) this.constructor_menu(message.resource.message);

                    // Если надо выполнить действия после
                    if (this.promise) this.promise(message.resource.message as any);
                })
        }*/
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
     */
    public setTime = (time: number) => {
        this.time = time;
        return this;
    };

    /**
     * @description Добавляем components в базу для дальнейшей отправки
     * @param data - Компоненты под сообщением
     */
    public addComponents = (data: MessageSendOptions["components"]) => {
        Object.assign(this.components, data);
        return this;
    };

    /**
     * @description Добавляем функцию для управления данными после отправки
     * @param func - Функция для выполнения после
     */
    public setPromise = (func: EmbedBuilder<T>["promise"]) => {
        this.promise = func;
        return this;
    };

    /**
     * @description Добавляем функцию для управления данными после отправки, для menu
     * @param func - Функция для выполнения после
     */
    public setCallback = (func: EmbedBuilder<T>["callback"]) => {
        this.callback = func;
        return this;
    };

    /**
     * @description Параметры для создания меню
     * @param options - Сами параметры
     */
    public setMenu = (options: EmbedBuilder<T>["_menu"]) => {
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

/**
 * @author SNIPPIK
 * @description Параметры для отправки сообщения
 */
export interface MessageSendOptions {
    components?: (ComponentData | ActionRowBuilder | MessageComponent)[];
    embeds?: EmbedData[];
    flags?: MessageFlags;
    context?: string;
    withResponse?: boolean;
}

/**
 * @author SNIPPIK
 * @description Компонент кнопки в json объекте
 */
export interface MessageComponent {
    type: 1 | 2,
    components: {
        type: 1 | 2,
        emoji?: {
            id?: string,
            name?: string
        },
        custom_id: string,
        style: 1 | 2 | 3 | 4,
        disable?: boolean
    }[],
}