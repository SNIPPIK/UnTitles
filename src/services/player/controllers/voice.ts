import { CommandInteraction, DiscordClient } from "#structures/discord";
import { QueueMessage } from "../structures/message";
import { VoiceConnection } from "#service/voice";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для управления голосовыми подключениями, хранит в себе все данные голосового подключения
 * @class ControllerVoice
 * @public
 */
export class ControllerVoice<T extends VoiceConnection> {
    /**
     * @description Текущее голосовое подключение к каналу на сервере
     * @private
     */
    private _connection: T;

    /**
     * @description Производим подключение к голосовому каналу
     * @param connection - Голосовой канал
     * @public
     */
    public set connection(connection: T) {
        if (this.connection) {
            if (this._connection.disconnect) this._connection.destroy();
        }

        this._connection = connection;
    };

    /**
     * @description Получение голосового подключения
     * @return VoiceConnection
     * @public
     */
    public get connection() {
        return this._connection;
    };

    /**
     * @description Подключение к голосовому каналу
     * @param client - Класс клиента для подключения
     * @param ctx - Параметры подключения
     * @returns void
     * @public
     */
    public join = (client: DiscordClient, ctx: QueueMessage<CommandInteraction>["voice"]) => {
        this.connection = db.voice.join({
            self_deaf: true,
            self_mute: false,
            guild_id: ctx.guild.id,
            channel_id: ctx.channelId
        }, client.adapter.createVoiceAdapter(ctx.guild.id)) as T;
    };
}