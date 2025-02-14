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
 * @description Время до следующей проверки жизни
 * @private
 */
export const TIMESTAMP_INC = (48_000 / 100) * 2;

/**
 * @author SNIPPIK
 * @description Выдаваемы методы для использования sodium
 * @class Encryption
 * @public
 */
export class Encryption {
    /**
     * @description Задаем единственный актуальный вариант шифрования
     * @public
     * @static
     */
    public static get mode(): EncryptionModes {
        return "aead_aes256_gcm_rtpsize";
    };

    /**
     * @description Buffer для режима шифрования, нужен для правильно расстановки пакетов
     * @public
     * @static
     */
    public static get nonce() {
        return Buffer.alloc(12);
    };

    /**
     * @description Буффер для создания UDP соединения
     * @public
     * @static
     */
    public static discoveryBuffer = (ssrc: number) => {
        const packet = Buffer.alloc(74);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        return packet;
    };

    /**
     * @description Задаем структуру пакета
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @public
     * @static
     */
    public static packet = (packet: Buffer, connectionData: ConnectionData) => {
        const { sequence, timestamp, ssrc } = connectionData;
        const rtp_packet = this.nonce;
        // Version + Flags, Payload Type
        [rtp_packet[0], rtp_packet[1]] = [0x80, 0x78];

        // Последовательность
        rtp_packet.writeUIntBE(sequence, 2, 2);

        // Временная метка
        rtp_packet.writeUIntBE(timestamp, 4, 4);

        // SSRC
        rtp_packet.writeUIntBE(ssrc, 8, 4);

        // Зашифрованный звук
        rtp_packet.copy(Buffer.alloc(32), 0, 0, 12);
        return this.crypto(packet, connectionData, rtp_packet);
    };

    /**
     * @description Подготавливаем пакет к отправке, выставляем правильную очередность
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @param rtp_packet - Доп данные для отправки
     * @private
     * @static
     */
    private static crypto = (packet: Buffer, connectionData: ConnectionData, rtp_packet: Buffer) => {
        connectionData.nonce++;

        if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
        connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);

        const nonceBuffer = connectionData.nonceBuffer.subarray(0, 4);

        // Шифровка aead_aes256_gcm (rtpsize)
        if (connectionData.encryptionMode.startsWith("aead_aes256_gcm")) {
            const cipher = crypto.createCipheriv("aes-256-gcm", connectionData.secretKey, connectionData.nonceBuffer, {autoDestroy: true});
            cipher.setAAD(rtp_packet);
            return Buffer.concat([rtp_packet, cipher.update(packet), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
        }

        /*
        // Шифровка aead_xchacha20_poly1305 (rtpsize) | Пока не работает
        else if (connectionData.encryptionMode.startsWith("aead_xchacha20_poly1305")) {
            const cipher = crypto.createCipheriv("chacha20-poly1305", connectionData.secretKey, connectionData.nonceBuffer, {autoDestroy: true, authTagLength: 16});
            return Buffer.concat([rtp_packet, cipher.update(packet), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
        }

         */

        // Если нет больше вариантов шифровки
        throw new Error(`[Sodium] ${this.mode} is not supported`);
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит
     * @param numberOfBits - Количество бит
     * @public
     * @static
     */
    public static randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);
}

/**
 * @author SNIPPIK
 * @description Все актуальные типы шифровки discord
 */
type EncryptionModes = "aead_aes256_gcm_rtpsize" | "aead_aes256_gcm" | "aead_xchacha20_poly1305_rtpsize";