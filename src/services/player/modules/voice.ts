import {VoiceConnection} from "@service/voice";

/**
 * @author SNIPPIK
 * @description Класс для управления голосовыми подключениями, хранит в себе все данные голосового подключения
 * @class PlayerVoice
 * @public
 */
export class PlayerVoice {
    /**
     * @description Текущее голосовое подключение к каналу на сервере
     * @private
     */
    private _connection: VoiceConnection;

    /**
     * @description Производим подключение к голосовому каналу
     * @public
     */
    public set connection(connection: VoiceConnection) {
        if (connection?.config) {
            // Если боту нельзя говорить, то смысл продолжать
            if (connection.config.self_mute) return;

            // Если повторное подключение к тому же голосовому каналу
            else if (this._connection && connection.config.channel_id === this._connection.config.channel_id) {
                connection.configureSocket;
            }
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
     * @description Отправляем пакет в голосовой канал
     * @public
     */
    public set send(packet: Buffer) {
        // Отправляем пакет в голосовой канал
        if (packet) {
            if (this.connection.state.status !== "ready") this.connection.configureSocket;
            this.connection.packet = packet;
        }
    };
}