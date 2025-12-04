import { VoiceAdapters, DiscordGatewayAdapterLibraryMethods } from "#core/voice/adapter";
import type { DiscordClient } from "#structures/discord/index.client";

/**
 * @author SNIPPIK
 * @description Класс реализации адаптера
 * @class DJSVoice
 * @extends VoiceAdapters
 * @public
 */
export class DJSVoice<T extends DiscordClient = DiscordClient> extends VoiceAdapters<DiscordClient> {
    public constructor(client: T) {
        super(client);

        //@ts-ignore
        client.ws.on("VOICE_SERVER_UPDATE", this.onVoiceServer);

        //@ts-ignore
        client.ws.on("VOICE_STATE_UPDATE", this.onVoiceStateUpdate);
    };

    /**
     * @description Создаем прослойку адаптера голосового соединения
     * @param guildID - ID сервера
     * @public
     */
    public voiceAdapterCreator = (guildID: string) => {
        const id = this.client.shardID;

        return (methods: DiscordGatewayAdapterLibraryMethods) => {
            this.adapters.set(guildID, methods);

            return {
                sendPayload: (data: object) => {
                    this.client.ws.shards.get(id)?.send(data);
                    return true;
                },
                destroy: () => {
                    this.adapters.delete(guildID);
                }
            };
        };
    };
}