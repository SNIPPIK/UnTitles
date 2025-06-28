import {DiscordGatewayAdapterCreator} from "#service/voice/adapter";
import {VoiceConnection} from "#service/voice/connection";
import {Collection} from "#structures";

// Voice Sockets
export * from "./sockets/ClientWebSocket";
export * from "./sockets/ClientUDPSocket";
export * from "./sockets/ClientSRTPSocket";

// Audio
export * from "./audio/resource";
export * from "./audio/process";

// Decoder and encoders
export * from "./audio/opus";
export * from "./connection";


/**
 * @author SNIPPIK
 * @description Класс для хранения голосовых подключений
 * @class Voices
 * @extends Collection
 */
export class Voices extends Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Функции для получения данных из VOICE_STATE_SERVER, VOICE_STATE_UPDATE
     * @public
     */
    public join = (config: VoiceConnection["configuration"], adapterCreator: DiscordGatewayAdapterCreator) => {
        let connection = this.get(config.guild_id);

        // Если нет голосового подключения
        if (!connection) {
            // Если нет голосового подключения, то создаем
            connection = new VoiceConnection(config, adapterCreator);
            this.set(config.guild_id, connection);
        }

        // Если голосовое соединение не может принимать пакеты
        else if (!connection.ready || connection.status === "disconnected") {
            this.remove(config.guild_id);
            connection = new VoiceConnection(config, adapterCreator);
            this.set(config.guild_id, connection);
        }

        // Отдаем голосовое подключение
        return connection;
    };
}