import type { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import { VoiceConnectionConfiguration } from "#core/voice";
import { GatewayOpcodes } from "discord-api-types/v10";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с клиентским websocket'ом
 * @class VoiceAdapters
 * @abstract
 * @public
 */
export abstract class VoiceAdapters {
    /**
     * @description Коллекция адаптеров для общения голоса с клиентским websocket'ом
     * @readonly
     * @private
     */
    private readonly adapters = new Map<string, DiscordGatewayAdapterLibraryMethods>();

    /**
     * @description Функция для отправки данные через клиентский websocket
     * @abstract
     * @public
     */
    protected abstract ws_send: (data: any | unknown) => void;

    /**
     * @description Создание адаптера для голосового состояния бота
     * @returns DiscordGatewayAdapterCreator
     * @public
     */
    public createVoiceAdapter = (guildID: string): DiscordGatewayAdapterCreator => {
        return methods => {
            this.adapters.set(guildID, methods);

            return {
                sendPayload: (data) => {
                    this.ws_send(data);
                    return true;
                },
                destroy: () => {
                    this.adapters.delete(guildID);
                }
            };
        };
    };

    /**
     * @description Поиск адаптера голосового соединения из данных и передаче данных VOICE_SERVER_UPDATE
     * @param payload - Данные голосового состояния
     * @returns void
     * @public
     */
    public onVoiceServer = (payload: GatewayVoiceServerUpdateDispatchData) => {
        this.adapters.get(payload.guild_id)?.onVoiceServerUpdate(payload);
    };

    /**
     * @description Поиск адаптера голосового соединения из данных и передаче данных VOICE_STATE_UPDATE
     * @param payload - Данные голосового состояния
     * @returns void
     * @public
     */
    public onVoiceStateUpdate = (payload: GatewayVoiceStateUpdateDispatchData) => {
        this.adapters.get(payload.guild_id)?.onVoiceStateUpdate(payload);
    };
}

/**
 * @author SNIPPIK
 * @description Класс для отправки данных через discord.js
 * @class VoiceAdapter
 * @private
 */
export class VoiceAdapter {
    /**
     * @description Внутренний интерфейс адаптера
     * @public
     */
    public adapter: DiscordGatewayAdapterImplementerMethods;

    /**
     * @description Пакеты для работы с голосовым подключением
     * @public
     */
    public packet = {
        /**
         * @description Пакет состояния на сервере
         * @public
         */
        server: undefined as GatewayVoiceServerUpdateDispatchData,

        /**
         * @description Пакет текущего голосового состояния
         * @public
         */
        state: undefined  as GatewayVoiceStateUpdateDispatchData
    };

    /**
     * @description Отправка данных о голосовом состоянии в Discord
     * @param config - Данные для подключения
     * @returns boolean
     * @public
     */
    public sendPayload = (config: VoiceConnectionConfiguration) => {
        try {
            return this.adapter?.sendPayload({op: GatewayOpcodes.VoiceStateUpdate, d: config });
        } catch (e) {
            console.error("hook error in adapter", e);
            return false;
        }
    };
}

/**
 * @description Шлюз Discord Адаптер, шлюза Discord.
 * @interface DiscordGatewayAdapterLibraryMethods
 */
export interface DiscordGatewayAdapterLibraryMethods {
    /**
     * @description Вызываем эту функцию, когда адаптер больше не может использоваться (например, из-за отключения от основного шлюза).
     */
    destroy(): void;

    /**
     * @description Вызываем этот метод при получении полезной нагрузки VOICE_SERVER_UPDATE, относящейся к адаптеру.
     * @param data - Внутренние данные полезной нагрузки VOICE_SERVER_UPDATE
     */
    onVoiceServerUpdate(data: GatewayVoiceServerUpdateDispatchData): void;

    /**
     * @description Вызываем этот метод при получении полезной нагрузки VOICE_STATE_UPDATE, относящейся к адаптеру.
     * @param data - Внутренние данные полезной нагрузки VOICE_STATE_UPDATE
     */
    onVoiceStateUpdate(data: GatewayVoiceStateUpdateDispatchData): void;
}

/**
 * @description Методы, предоставляемые разработчиком адаптера Discord Gateway для DiscordGatewayAdapter.
 * @interface DiscordGatewayAdapterImplementerMethods
 */
export interface DiscordGatewayAdapterImplementerMethods {
    /**
     * @description Это будет вызвано voice, когда адаптер можно будет безопасно уничтожить, поскольку он больше не будет использоваться.
     */
    destroy(): void;

    /**
     * @description Реализуйте этот метод таким образом, чтобы данная полезная нагрузка отправлялась на основное соединение Discord gateway.
     * @param payload - Полезная нагрузка для отправки на основное соединение Discord gateway
     * @returns `false`, если полезная нагрузка определенно не была отправлена - в этом случае голосовое соединение отключается
     */
    sendPayload(payload: any): boolean;
}

/**
 * Функция, используемая для создания адаптеров. Она принимает параметр methods, содержащий функции, которые
 * могут быть вызваны разработчиком при получении новых данных по его шлюзовому соединению. В свою очередь,
 * разработчик вернет некоторые методы, которые может вызывать библиотека - например, для отправки сообщений на
 * шлюз или для подачи сигнала о том, что адаптер может быть удален.
 * @type DiscordGatewayAdapterCreator
 */
export type DiscordGatewayAdapterCreator = ( methods: DiscordGatewayAdapterLibraryMethods) => DiscordGatewayAdapterImplementerMethods;