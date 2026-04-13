import { BaseLayer } from "#core/voice/transport/layers/BaseLayer";
import { VoiceRTPSocket, iType} from "#native";

export class RTPLayer extends BaseLayer<Buffer[]> {
    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @public
     */
    public _rtp: iType<typeof VoiceRTPSocket>;

    /**
     * @description Готовность RTP слоя
     * @public
     */
    public get ready() {
        return !!this._rtp;
    };

    /**
     * @description Метод обертки пакетов, может как возвращать так и не возращать результат
     * @param frames
     * @public
     */
    public packet = (frames: Buffer[]) => {
        let rtp = this._rtp.packets(frames);
        /*let attempts = 0;

        // Даем шанс на повтор
        while (!rtp && attempts < BaseLayer.MAX_RETRIES) {
            attempts++;
            rtp = this._rtp.packets(frames);
        }*/

        if (!rtp) {
            throw new Error("RTP packet creation failed after retries");
        }

        return rtp;
    };

    /**
     * @description Создание ключевого обьекта
     * @param ssrc
     * @param secret_key
     */
    public create = (ssrc: number, secret_key: number[]) => {
        // Если уже есть активный RTP
        if (this._rtp) {
            this._rtp.destroy();
            this._rtp = null;
        }

        // Создаем подключение RTP
        this._rtp = new VoiceRTPSocket(
            ssrc,
            new Uint8Array(secret_key)
        );
    };

    /**
     * @description Метод удаления RTP слоя
     * @public
     */
    public destroy = () => {
        this._rtp.destroy();
        this._rtp = null;
    };
}