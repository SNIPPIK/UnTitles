import { VoiceAdapters, DiscordGatewayAdapterCreator } from "#core/voice/transport/adapter";
import type { DiscordClient } from "#structures/discord/index.client";

/**
 * @author SNIPPIK
 * @description Класс адаптера
 * @class SeyfertVoice
 * @extends VoiceAdapters
 */
export class SeyfertVoice<T extends DiscordClient> extends VoiceAdapters<DiscordClient> {
    public constructor(client: T) {
        super(client);
    };

    /**
     * @description Указываем как создавать адаптер
     * @param guild_id - ID сервера для которого надо создать адаптер
     * @public
     */
    public voiceAdapterCreator = (guild_id: string): DiscordGatewayAdapterCreator => {
        // Если нет ID осколка
        const id = this.client.gateway.calculateShardId(guild_id);

        return methods => {
            this.adapters.set(guild_id, methods);

            return {
                send: (data) => {
                    try {
                        this.client.gateway.send(id, data);
                    } catch { return false; }
                    return true;
                },
                destroy: () => {
                    this.adapters.delete(guild_id);
                }
            };
        };
    };

    /**
     * @description Реализация смены статуса голосового канала
     * @param channelId - ID голосового канала
     * @param status - Название заголовка
     * @public
     */
    public status = (channelId: string, status?: string) => {
        return this.client.rest.request("PUT", `/channels/${channelId}/voice-status`, {
            body: {
                status: status
            }
        }).catch(() => {});
    };
}