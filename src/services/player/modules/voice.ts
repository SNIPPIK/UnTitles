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