import { VoiceAdapters, DiscordGatewayAdapterCreator } from "#core/voice/transport/adapter";
import type { DiscordClient } from "#structures/discord/index.client";
import { WebSocketShardEvents, CloseCodes } from "discord.js";

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
        client.ws.on(WebSocketShardEvents.Closed, (code, shardId) => {
            if (code === CloseCodes.Normal) {
                for (const [guildId, adapter] of this.adapters.entries()) {
                    if (client.guilds.cache.get(guildId)?.shardId === shardId) {
                        adapter.destroy();
                    }
                }
            }
        });
    };

    /**
     * @description Реализация смены статуса голосового канала
     * @param channelId - ID голосового канала
     * @param status - Название заголовка
     * @public
     */
    public status = async (channelId: string, status: string = "") => {
        return this.client.rest.put(`/channels/${channelId}/voice-status`, {
            body: {
                status: status
            }
        }).catch(() => null);
    };

    /**
     * @description Создаем прослойку адаптера голосового соединения
     * @param guildID - ID сервера
     * @public
     */
    public voiceAdapterCreator = (guildID: string): DiscordGatewayAdapterCreator => {
        const id = this.client.shardID;

        return methods => {
            this.adapters.set(guildID, methods);

            return {
                send: (data) => {
                    this.client.ws.send(id, data as any)
                    return true;
                },
                destroy: () => {
                    this.adapters.delete(guildID);
                }
            };
        };
    };
}