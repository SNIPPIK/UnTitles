import {isMainThread} from "node:worker_threads";
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
 * @description Поддерживаемые типы шифрования
 * @private
 */
const EncryptionModes: EncryptionModes[] = [];

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
     */
    public static get mode(): EncryptionModes {
        return EncryptionModes[0];
    };

    /**
     * @description Buffer для режима шифрования, нужен для правильно расстановки пакетов
     * @public
     */
    public static get nonce() {
        if (this.mode === "aead_aes256_gcm_rtpsize") return Buffer.alloc(12);
        return Buffer.alloc(24);
    };

    /**
     * @description Задаем структуру пакета
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @public
     */
    public static packet = (packet: Buffer, connectionData: ConnectionData) => {
        const { sequence, timestamp, ssrc } = connectionData;
        const rtp_packet = Buffer.alloc(12);
        // Version + Flags, Payload Type
        [rtp_packet[0], rtp_packet[1]] = [0x80, 0x78];

        // Последовательность
        rtp_packet.writeUIntBE(sequence, 2, 2);

        // Временная метка
        rtp_packet.writeUIntBE(timestamp, 4, 4);

        // SSRC
        rtp_packet.writeUIntBE(ssrc, 8, 4);

        // Зашифрованный звук
        rtp_packet.copy(Buffer.alloc(24), 0, 0, 12);

        connectionData.nonce++;

        // Если нет пакета или номер пакет превышен максимальный, то его надо сбросить
        if (connectionData.nonce > MAX_NONCE_SIZE) {
            connectionData.nonce = 0;
        }

        connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
        return this.crypto(packet, connectionData, rtp_packet);
    };

    /**
     * @description Подготавливаем пакет к отправке, выставляем правильную очередность
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     * @param rtp_packet - Доп данные для отправки
     * @private
     */
    private static crypto = (packet: Buffer, connectionData: ConnectionData, rtp_packet: Buffer) => {
        const nonceBuffer = connectionData.nonceBuffer.subarray(0, 4);

        // Шифровка aead_aes256_gcm (support rtpsize)
        if (connectionData.encryptionMode === "aead_aes256_gcm_rtpsize") {
            const cipher = crypto.createCipheriv("aes-256-gcm", connectionData.secretKey, connectionData.nonceBuffer);
            cipher.setAAD(rtp_packet);
            return Buffer.concat([rtp_packet, cipher.update(packet), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
        }

        // Шифровка через библиотеку
        else if (connectionData.encryptionMode === "aead_xchacha20_poly1305_rtpsize") {
            const cryptoPacket = loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(packet, rtp_packet, connectionData.nonceBuffer, connectionData.secretKey);
            return Buffer.concat([rtp_packet, cryptoPacket, nonceBuffer]);
        }

        // Если нет больше вариантов шифровки
        throw new Error(`[Sodium] ${this.mode} is not supported`);
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит
     * @param numberOfBits - Количество бит
     * @public
     */
    public static randomNBit = (numberOfBits: number) => Math.floor(Math.random() * 2 ** numberOfBits);
}

/**
 * @author SNIPPIK
 * @description Здесь будет находиться найденная библиотека, если она конечно будет найдена
 * @private
 */
let loaded_lib: Methods.current = {};

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие поддержки sodium
 */
(async () => {
    if (!isMainThread) return;

    // Если поддерживается нативная расшифровка
    if (crypto.getCiphers().includes("aes-256-gcm")) {
        EncryptionModes.push("aead_aes256_gcm_rtpsize");
        return;
    }

    // Если нет нативной поддержки шифрования
    else {
        /**
         * @author SNIPPIK
         * @description Поддерживаемые библиотеки
         */
        const support_libs: Methods.supported = {
            sodium: (sodium) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt:(plaintext: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike) => {
                    return sodium.api.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, null, nonce, key);
                }
            }),
            "sodium-native": (lib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt:(plaintext, additionalData, nonce, key) => {
                    const cipherText = Buffer.alloc(plaintext.length + lib.crypto_aead_xchacha20poly1305_ietf_ABYTES);
                    lib.crypto_aead_xchacha20poly1305_ietf_encrypt(cipherText, plaintext, additionalData, null, nonce, key);
                    return cipherText;
                }
            }),
            '@stablelib/xchacha20poly1305': (stablelib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt(cipherText, additionalData, nonce, key) {
                    const crypto = new stablelib.XChaCha20Poly1305(key);
                    return crypto.seal(nonce, cipherText, additionalData);
                },
            }),
            '@noble/ciphers/chacha': (noble) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, nonce, key) {
                    const chacha = noble.xchacha20poly1305(key, nonce, additionalData);
                    return chacha.encrypt(plaintext);
                },
            })
        }, names = Object.keys(support_libs);

        // Добавляем тип шифрования
        EncryptionModes.push("aead_xchacha20_poly1305_rtpsize");

        // Делаем проверку всех доступных библиотек
        for (const name of names) {
            try {
                const library = await import(name);
                if (library?.ready) await library.ready;
                Object.assign(loaded_lib, support_libs[name](library));
                delete require.cache[require.resolve(name)];
                return;
            } catch {}
        }

        // Если нет установленных библиотек
        throw Error(`[Critical]: No encryption package is installed. Set one to choose from.\n - ${names.join("\n - ")}`);
    }
})();

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
        [name: string]: (lib: any) => current
    }

    /**
     * @description Новый тип шифровки пакетов
     * @interface current
     */
    export interface current {
        crypto_aead_xchacha20poly1305_ietf_encrypt?(plaintext: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike | Uint8Array): Buffer;
    }
}

/**
 * @author SNIPPIK
 * @description Все актуальные типы шифровки discord
 * @private
 */
type EncryptionModes = "aead_aes256_gcm_rtpsize"| "aead_xchacha20_poly1305_rtpsize";