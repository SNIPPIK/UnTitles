import {DiscordGatewayAdapterCreator, VoiceConfig, VoiceConnection, VoiceConnectionStatus} from "@lib/voice";
import {Constructor} from "@lib/handler";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с modules
 * @class Database_Voice
 * @public
 */
export class Database_Voice extends Constructor.Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Для отправки пакетов
     * @public
     */
    public join = (config: VoiceConfig, adapterCreator: DiscordGatewayAdapterCreator): VoiceConnection => {
        let connection = this.get(config.guildId);

        //Если нет голосового подключения, то создаем и сохраняем в базу
        if (!connection) {
            connection = new VoiceConnection(config as any, {adapterCreator});
            this.set(config.guildId, connection);
        }

        //Если есть голосовое подключение, то подключаемся заново
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin(config as any);
            else if (!connection.state.adapter.sendPayload(connection.payload(config))) connection.state = { ...connection.state, status: "disconnected" as any, reason: 1 };
        }

        return connection;
    };
}