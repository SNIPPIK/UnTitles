import { BaseLayer } from "#core/voice/transport/layers/BaseLayer.js";
import { VoiceRTPSocket, iType} from "#native";

export class RTPLayer extends BaseLayer<iType<typeof VoiceRTPSocket>> {
    /**
     * @description Готовность RTP слоя
     * @public
     */
    public get ready() {
        return !!this._client;
    };

    /**
     * @description Метод обертки пакетов, может как возвращать так и не возращать результат
     * @param frames
     * @public
     */
    public packet = (frames: Buffer[]) => {
        if (!this._client) return null;
        return this._client.packets(frames);
    };

    /**
     * @description Создание ключевого обьекта
     * @param ssrc
     * @param secret_key
     */
    public create = (ssrc: number, secret_key: number[]) => {
        // Если уже есть активный RTP
        if (this._client) {
            this._client.destroy();
            this._client = null;
        }

        // Создаем подключение RTP
        this._client = new VoiceRTPSocket(
            ssrc,
            new Uint8Array(secret_key) as any
        );
    };
}