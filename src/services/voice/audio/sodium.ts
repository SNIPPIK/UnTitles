import {ConnectionData} from "@service/voice";
import {Buffer} from "node:buffer";
import crypto from "node:crypto";

/**
 * @author SNIPPIK
 * @description Максимальный размер пакета
 * @private
 */
const MAX_NONCE_SIZE = 2 ** 32 - 1;

/**
 * @author SNIPPIK
 * @description Выдаваемы методы для использования sodium
 * @class Encryption
 * @public
 */
export class Encryption {
    /**
     * @description Выбирает режим шифрования из списка заданных параметров. Выбирает наиболее предпочтительный вариант.
     * @public
     * @static
     */
    public static get mode() { return "aead_aes256_gcm_rtpsize"; };

    /**
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @public
     * @static
     */
    public static packet = (packet: Buffer, connectionData: ConnectionData) => {
        const rtp_packet = Buffer.alloc(12);
        rtp_packet[0] = 0x80;
        rtp_packet[1] = 0x78;

        const { sequence, timestamp, ssrc } = connectionData;

        rtp_packet.writeUIntBE(sequence, 2, 2);
        rtp_packet.writeUIntBE(timestamp, 4, 4);
        rtp_packet.writeUIntBE(ssrc, 8, 4);

        rtp_packet.copy(Buffer.alloc(24), 0, 0, 12);
        return Buffer.concat([rtp_packet, ...this.crypto(packet, connectionData, rtp_packet)]);
    };

    /**
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @param additionalData - Доп данные для отправки
     * @private
     * @static
     */
    private static crypto = (packet: Buffer, connectionData: ConnectionData, additionalData: Buffer) => {
        // Оба поддерживаемых метода шифрования требуют, чтобы одноразовое число было инкрементным целым числом.
        connectionData.nonce++;
        if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
        connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);

        const cipher = crypto.createCipheriv("aes-256-gcm", connectionData.secretKey, connectionData.nonceBuffer, {autoDestroy: true});
        cipher.setAAD(additionalData);
        return [Buffer.concat([cipher.update(packet), cipher.final(), cipher.getAuthTag()]), connectionData.nonceBuffer.subarray(0, 4)];
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит.
     * @param numberOfBits - Количество бит
     * @public
     * @static
     */
    public static randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);
}