import { VoiceConnection } from "#core/voice";

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
        // Если уже есть голосовое подключение
        if (this.connection) {
            // Если можно отключится
            if (this._connection.disconnect) this._connection.destroy();
        }

        // Перезаписываем старое на новое
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
}