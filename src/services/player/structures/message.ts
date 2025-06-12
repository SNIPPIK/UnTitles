import {CommandInteraction, CycleInteraction, DiscordClient} from "#structures";
import { EmbedData } from "discord.js";

/**
 * @author SNIPPIK
 * @description Прослойка для правильной работы очереди
 * @class QueueMessage
 * @public
 */
export class QueueMessage<T extends CommandInteraction> {
    private readonly _guildID: string;
    private readonly _channelID: string;
    private readonly _voiceID: string;

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
     * @description Получение ID сервера
     * @public
     */
    public get guildID() {
        return this._guildID;
    };

    /**
     * @description Получение текущего текстового канала
     * @public
     */
    public get channel() {
        return this._original.channel;
    };

    /**
     * @description Получение ID текстового канала
     * @public
     */
    public get channelID() {
        return this._channelID;
    };

    /**
     * @description Получение текущего голосового соединения пользователя
     * @public
     */
    public get voice() {
        return this._original.member.voice;
    };

    /**
     * @description Получение ID голосового канала
     * @public
     */
    public get voiceID() {
        return this._voiceID;
    };

    /**
     * @description Получение класса клиента
     * @public
     */
    public get client() {
        return this._original.client as DiscordClient;
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
     * @description Создаем класс для общения с discord api
     * @param _original - Класс сообщения
     * @public
     */
    public constructor(private readonly _original: T) {
        this._voiceID = _original.member.voice.channelId;
        this._channelID = _original.channelId;
        this._guildID = _original.guildId;
    };

    /**
     * @description Авто отправка сообщения
     * @param options - Параметры сообщения
     * @public
     */
    public send = (options: {embeds: EmbedData[], components?: any[], withResponse: boolean, flags?: "Ephemeral" | "IsComponentsV2"}): Promise<CycleInteraction> => {
        try {
            // Если бот уже ответил на сообщение
            if (this.replied && !this.deferred) return this._original.followUp(options as any) as any;

            // Если можно просто отредактировать сообщение
            else if (this.deferred && !this.replied) return this._original.editReply(options as any) as any;

            // Если можно дать ответ на сообщение
            else if (!this.deferred && !this.replied) return this._original.reply(options as any) as any;

            // Отправляем обычное сообщение
            return this._original.channel.send(options as any);
        } catch {
            // Отправляем обычное сообщение
            return this._original.channel.send(options as any);
        }
    };
}