import type { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import type { DiscordGatewayAdapterCreator, DiscordGatewayAdapterLibraryMethods } from "#service/voice/adapter";
import type { DiscordClient } from "../Client";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия с клиентским websocket'ом
 * @class VoiceManager
 */
export class VoiceManager<Client extends DiscordClient> {
    /**
     * @description Коллекция адаптеров для общения голоса с клиентским websocket'ом
     * @readonly
     * @private
     */
    private readonly adapters = new Map<string, DiscordGatewayAdapterLibraryMethods>();

    /**
     * @description Создание класса
     * @param client - Класс клиента
     * @constructor
     * @public
     */
    public constructor(private client: Client) {
        //@ts-ignore
        client.ws.on("VOICE_SERVER_UPDATE", (data) => {
            this.onVoiceServer(data);
        });

        //@ts-ignore
        client.ws.on("VOICE_STATE_UPDATE", (data) => {
            this.onVoiceStateUpdate(data);
        });
    };

    /**
     * @description Создание адаптера для голосового состояния бота
     * @returns DiscordGatewayAdapterCreator
     * @public
     */
    public createVoiceAdapter = (guildID: string): DiscordGatewayAdapterCreator => {
        // Если нет ID осколка
        const id = this.client.shardID;

        return methods => {
            this.adapters.set(guildID, methods);

            return {
                sendPayload: (data) => {
                    this.client.ws.shards.get(id).send(data);
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