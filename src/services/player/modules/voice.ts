import {VoiceConnection} from "@service/voice";

/**
 * @author SNIPPIK
 * @description Класс для управления голосовыми подключениями, хранит в себе все данные голосового подключения
 * @class PlayerVoice
 * @protected
 */
export class PlayerVoice {
    /**
     * @description Текущее голосовое подключение к каналу на сервере
     * @private
     */
    private _connection: VoiceConnection = null;

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
        try {
            if (packet) this.connection.packet = packet;
        } catch (err) {
            // Если возникает ошибка, то сообщаем о ней
            console.log(err);
        }
    };
}