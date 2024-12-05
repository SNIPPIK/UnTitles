import {ConnectionData} from "../socket";
import {Buffer} from "node:buffer";
import crypto from "node:crypto";

/**
 * @author SNIPPIK
 * @description Поддерживаемые библиотеки
 * @private
 */
const support_libs: Methods.supported = {
    "sodium-native": (lib) => ({
        close: (opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array) => {
            const output = Buffer.allocUnsafe(opusPacket.length + lib.crypto_box_MACBYTES);
            lib.crypto_secretbox_easy(output, opusPacket, nonce, secretKey);
            return output;
        },
        random(num: number, buffer: Buffer = Buffer.allocUnsafe(num)) {
            lib.randombytes_buf(buffer);
            return buffer;
        },
        crypto_aead_xchacha20poly1305_ietf_decrypt: (cipherText, additionalData, nonce, key) => {
            const message = Buffer.alloc(cipherText.length - lib.crypto_aead_xchacha20poly1305_ietf_ABYTES);
            lib.crypto_aead_xchacha20poly1305_ietf_decrypt(message, null, cipherText, additionalData, nonce, key);
            return message;
        },
        crypto_aead_xchacha20poly1305_ietf_encrypt: (plaintext, additionalData, nonce, key) => {
            const cipherText = Buffer.alloc(plaintext.length + lib.crypto_aead_xchacha20poly1305_ietf_ABYTES);
            lib.crypto_aead_xchacha20poly1305_ietf_encrypt(cipherText, plaintext, additionalData, null, nonce, key);
            return cipherText;
        }
    }),

    "libsodium-wrappers": (lib) => ({
        close: lib.crypto_secretbox_easy,
        random: lib.randombytes_buf,
        crypto_aead_xchacha20poly1305_ietf_decrypt: (cipherText: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike) => {
            return lib.crypto_aead_xchacha20poly1305_ietf_decrypt(null, cipherText, additionalData, nonce, key);
        },
        crypto_aead_xchacha20poly1305_ietf_encrypt: (plaintext: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike) => {
            return lib.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, null, nonce, key);
        }
    })
};

/**
 * @author SNIPPIK
 * @description Здесь будет находиться найденная библиотека, если она конечно будет найдена
 * @private
 */
const loaded_lib: Methods._new = {};

/**
 * @author SNIPPIK
 * @description Максимальный размер пакета
 * @private
 */
const MAX_NONCE_SIZE = 2 ** 32 - 1;

/**
 * @author SNIPPIK
 * @description Доступные заголовки для отправки opus пакетов
 * @private
 */
const SUPPORTED_ENCRYPTION_MODES = [
    "aead_xchacha20_poly1305_rtpsize",

    // Старые модификаторы
    "xsalsa20_poly1305",
    "xsalsa20_poly1305_lite",
    "xsalsa20_poly1305_suffix"
];

/**
 * @author SNIPPIK
 * @description Выдаваемы методы для использования sodium
 * @class Encryption
 * @public
 */
export class Encryption {
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
        const { secretKey, encryptionMode } = connectionData;

        // Оба поддерживаемых метода шифрования требуют, чтобы одноразовое число было инкрементным целым числом.
        connectionData.nonce++;
        if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
        connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);

        // 4 дополнительных байта заполнения в конце зашифрованного пакета
        const noncePadding = connectionData.nonceBuffer.subarray(0, 4);
        switch (encryptionMode) {
            /**
             * @description Новые методы шифрования
             */
            case "aead_aes256_gcm_rtpsize": {
                const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, connectionData.nonceBuffer);
                cipher.setAAD(additionalData);
                return [Buffer.concat([cipher.update(packet), cipher.final(), cipher.getAuthTag()]), noncePadding];
            }
            case "aead_xchacha20_poly1305_rtpsize": {
                return [loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(packet, additionalData, connectionData.nonceBuffer, secretKey), noncePadding];
            }

            /**
             * @description Старые методы шифрования
             */
            case "xsalsa20_poly1305_suffix": {
                const random = loaded_lib.random(24, connectionData.nonceBuffer);
                return [loaded_lib.close(packet, random, secretKey), random];
            }
            case "xsalsa20_poly1305_lite": {
                connectionData.nonce++;
                if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
                connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
                return [loaded_lib.close(packet, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4)];
            }

            /**
             * @description Старый метод при отсутствии поддержки новых стандартов
             */
            default: return [loaded_lib.close(packet, Buffer.alloc(24), secretKey)];
        }
    }

    /**
     * @description Выбирает режим шифрования из списка заданных параметров. Выбирает наиболее предпочтительный вариант.
     * @param options - Доступные варианты шифрования
     * @public
     * @static
     */
    public static mode(options: string[]): string {
        const option = options.find((option) => SUPPORTED_ENCRYPTION_MODES.includes(option));
        if (!option) throw new Error(`No compatible encryption modes. Available include: ${options.join(', ')}`);

        return option;
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит.
     * @param numberOfBits - Количество бит
     * @public
     * @static
     */
    public static randomNBit(numberOfBits: number) {
        return Math.floor(Math.random() * 2 ** numberOfBits);
    };
}

/**
 * @author SNIPPIK
 * @description Поддерживаемые методы шифровки пакетов
 * @namespace Methods
 * @private
 */
namespace Methods {
    /**
     * @description Поддерживаемый запрос к библиотеке
     * @type supported
     */
    export type supported = {
        [name: string]: (lib: any) => _new
    }

    /**
     * @description Новый тип шифровки пакетов
     * @interface _new
     */
    export interface _new {
        crypto_aead_xchacha20poly1305_ietf_decrypt?(cipherText: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike | Uint8Array): Buffer;
        crypto_aead_xchacha20poly1305_ietf_encrypt?(plaintext: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike | Uint8Array): Buffer;
        close?(opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer;
        random?(bytes: number, nonce: Buffer): Buffer;
    }
}



/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие библиотек Sodium
 * @async
 */
(async () => {
    const names = Object.keys(support_libs), libs = `\n - ${names.join("\n - ")}`;

    for (const name of names) {
        try {
            const library = require(name);
            if (library?.ready) await library.ready;
            Object.assign(loaded_lib, support_libs[name](library));
            delete require.cache[require.resolve(name)];
            return;
        } catch {}
    }

    throw Error(`[Critical]: No encryption package is installed. Set one to choose from. ${libs}`);
})();