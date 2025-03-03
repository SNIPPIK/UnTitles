import {VoiceConnection, VoiceConnectionStatus} from "@service/voice";
import type {DiscordGatewayAdapterCreator} from "@service/voice";
import {Collection} from "@utils";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с modules
 * @class dbl_voice
 * @public
 */
export class db_voice extends Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Для отправки пакетов
     * @public
     */
    public join = (config: VoiceConnection["config"], adapterCreator: DiscordGatewayAdapterCreator) => {
        let connection = this.get(config.guild_id);

        // Если есть голосовое подключение при подключении
        if (connection) {
            // Удаляем голосовое подключение
            this.remove(connection.config.guild_id);
            connection = null;
        }

        // Если нет голосового подключения, то создаем и сохраняем в базу
        if (!connection) {
            connection = new VoiceConnection(config, adapterCreator);
            this.set(config.guild_id, connection);
        }

        // Если есть голосовое подключение, то подключаемся заново
        if (connection && connection.state.status !== VoiceConnectionStatus.Destroyed) {
            if (connection.state.status === VoiceConnectionStatus.Disconnected) connection.rejoin(config);
            else if (!connection.state.adapter.sendPayload(connection.payload(config))) {
                connection.state = { ...connection.state,
                    status: VoiceConnectionStatus.Disconnected,
                    reason: 1
                };
            }
        }

        return connection;
    };
}