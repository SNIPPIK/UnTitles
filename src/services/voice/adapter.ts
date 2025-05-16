import {GatewayOpcodes, GatewayVoiceStateUpdateDispatchData, GatewayVoiceServerUpdateDispatchData} from "discord-api-types/v10";
import {DiscordGatewayAdapterImplementerMethods, } from "@structures/discord/modules/VoiceManager";
import {VoiceConnectionConfiguration} from "./connection";

/**
 * @author SNIPPIK
 * @description Класс для отправки данных через discord.js
 * @class VoiceAdapter
 * @private
 */
export class VoiceAdapter {
    /**
     * @description
     * @public
     */
    public adapter: DiscordGatewayAdapterImplementerMethods = null;

    /**
     * @description Пакеты для работы с голосовым подключением
     * @public
     */
    public packet = {
        /**
         * @description Пакет состояния на сервере
         * @private
         */
        server: undefined as GatewayVoiceServerUpdateDispatchData,

        /**
         * @description Пакет текущего состояния
         * @private
         */
        state: undefined  as GatewayVoiceStateUpdateDispatchData
    };

    /**
     * @description Отправка данных о голосовом состоянии в Discord
     * @param config - Данные для подключения
     * @public
     */
    public sendPayload = (config: VoiceConnectionConfiguration) => {
        try {
            return this.adapter.sendPayload({op: GatewayOpcodes.VoiceStateUpdate, d: config });
        } catch (e) {
            console.error("hook error in adapter", e);
            return false;
        }
    };
}