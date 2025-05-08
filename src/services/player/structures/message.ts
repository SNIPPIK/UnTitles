import {CommandInteraction, CycleInteraction} from "@structures";
import {EmbedData} from "discord.js";

/**
 * @author SNIPPIK
 * @description Прослойка для правильной работы очереди
 * @class QueueMessage
 */
export class QueueMessage<T extends CommandInteraction> {
    /**
     * @description Язык сообщения
     * @public
     */
    public get locale() {
        return this._original?.locale ?? this._original?.guildLocale
    };

    /**
     * @description Получение класса о сервере
     * @public
     */
    public get guild() {
        return this._original.guild;
    };

    /**
     * @description Получение текущего текстового канала
     * @public
     */
    public get channel() {
        return this._original.channel;
    };

    /**
     * @description Получение текущего голосового соединения пользователя
     * @public
     */
    public get voice() {
        return this._original.member.voice;
    };

    /**
     * @description Получение класса клиента
     * @public
     */
    public get client() {
        return this._original.client;
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Ответил ли бот пользователю?
     * @public
     */
    public get replied() {
        return this._original["replied"];
    };

    /**
     * @description Параметр отвечает за правильную работу сообщения
     * @example Можно ли ответить на другое сообщение?
     * @public
     */
    public get deferred() {
        return this._original["deferred"];
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
     * @description Создаем класс для общения с discord api
     * @param _original - Класс сообщения
     * @public
     */
    public constructor(private readonly _original: T) {};

    /**
     * @description Авто отправка сообщения
     * @param options - Параметры сообщения
     * @public
     */
    public send = (options: {embeds: EmbedData[], components?: any[], withResponse: boolean, flags?: "Ephemeral" | "IsComponentsV2"}): Promise<CycleInteraction> => {
        const type = this.type;

        // Отправляем обычное сообщение
        if (type === "send") return this._original.channel[type](options as any);
        return this._original[type](options as any) as any;
    };
}