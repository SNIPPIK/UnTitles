import {ConnectionData} from "../socket";
import {Buffer} from "node:buffer";
import process from "node:process";

/**
 * @author SNIPPIK
 * @description Доступные библиотеки для включения
 */
const SodiumLibs = {
    "sodium-native": (sodium: any): Methods => ({
        open(buffer, nonce, secretKey) {
            if (buffer) {
                const output = Buffer.allocUnsafe(buffer.length - sodium.crypto_box_MACBYTES);
                if (sodium.crypto_secretbox_open_easy(output, buffer, nonce, secretKey)) return output;
            }

            return null;
        },

        random(num: number, buffer: Buffer = Buffer.allocUnsafe(num)) {
            sodium.randombytes_buf(buffer);
            return buffer;
        },

        close: (opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array) => {
            const output = Buffer.allocUnsafe(opusPacket.length + sodium.crypto_box_MACBYTES);
            sodium.crypto_secretbox_easy(output, opusPacket, nonce, secretKey);
            return output;
        }
    }),
    "sodium": (sodium: any): Methods => ({
        open: sodium.api.crypto_secretbox_open_easy,
        close: sodium.api.crypto_secretbox_easy,
        random: (num, buffer: Buffer = Buffer.allocUnsafe(num)) => {
            sodium.api.randombytes_buf(buffer);
            return buffer;
        }
    }),
    "libsodium-wrappers": (sodium: any): Methods => ({
        open: sodium.crypto_secretbox_open_easy,
        close: sodium.crypto_secretbox_easy,
        random: sodium.randombytes_buf,
    }),
    "tweetnacl": (tweetnacl: any): Methods => ({
        open: tweetnacl.secretbox.open,
        close: tweetnacl.secretbox,
        random: tweetnacl.randomBytes,
    }),
}, Sodium: Methods = {};

/**
 * @description Максимальный размер пакета
 */
const MAX_NONCE_SIZE = 2 ** 32 - 1;

/**
 * @description Доступные заголовки для отправки opus пакетов
 */
const SUPPORTED_ENCRYPTION_MODES = [ "_lite", "_suffix", ""].map(item => `xsalsa20_poly1305${item}`);

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие библиотек Sodium
 */
(async () => {
    const names = Object.keys(SodiumLibs), libs = `\n - ${names.join("\n - ")}`;

    for (const name of names) {
        try {
            const library = require(name);
            if (library?.ready) await library.ready;

            Object.assign(Sodium, SodiumLibs[name](library));
            delete require.cache[require.resolve(name)];
            return;
        } catch {}
    }

    throw new Error(`[Critical]: No encryption package is installed. Set one to choose from. ${libs}`);
})();

/**
 * @author SNIPPIK
 * @description Выдаваемы методы для использования sodium
 * @class Encryption
 */
export class Encryption {
    /**
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     */
    public static packet = (packet: Buffer, connectionData: ConnectionData) => {
        const {sequence, timestamp, ssrc} = connectionData;

        const opusPacket = Buffer.alloc(12);
        opusPacket[0] = 0x80;
        opusPacket[1] = 0x78;

        opusPacket.writeUIntBE(sequence, 2, 2);
        opusPacket.writeUIntBE(timestamp, 4, 4);
        opusPacket.writeUIntBE(ssrc, 8, 4);
        opusPacket.copy(Buffer.alloc(24), 0, 0, 12);

        return Buffer.concat([opusPacket, ...Encryption.crypto(packet, connectionData)]);
    };

    /**
     * @description Шифрует пакет Opus, используя формат, согласованный экземпляром и Discord.
     * @param packet - Пакет Opus для шифрования
     * @param connectionData - Текущие данные подключения экземпляра
     */
    private static crypto = (packet: Buffer, connectionData: ConnectionData) => {
        const {secretKey, encryptionMode} = connectionData;

        //Режимы расшифровщики
        switch (encryptionMode) {
            case "xsalsa20_poly1305_suffix": {
                const random = Sodium.random(24, connectionData.nonceBuffer);
                return [Sodium.close(packet, random, secretKey), random];
            }
            case "xsalsa20_poly1305_lite": {
                connectionData.nonce++;
                if (connectionData.nonce > MAX_NONCE_SIZE) connectionData.nonce = 0;
                connectionData.nonceBuffer.writeUInt32BE(connectionData.nonce, 0);
                return [Sodium.close(packet, connectionData.nonceBuffer, secretKey), connectionData.nonceBuffer.subarray(0, 4)];
            }
            default: return [Sodium.close(packet, Buffer.alloc(24), secretKey)];
        }
    }

    /**
     * @description Выбирает режим шифрования из списка заданных параметров. Выбирает наиболее предпочтительный вариант.
     * @param options - Доступные варианты шифрования
     */
    public static mode(options: string[]): string {
        const option = options.find((option) => SUPPORTED_ENCRYPTION_MODES.includes(option));
        if (!option) throw new Error(`No compatible encryption modes. Available include: ${options.join(', ')}`);

        return option;
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит.
     * @param numberOfBits - Количество бит
     */
    public static randomNBit(numberOfBits: number) {
        return Math.floor(Math.random() * 2 ** numberOfBits);
    };
}

/**
 * @description Выдаваемы методы для работы voice
 */
interface Methods {
    close?(opusPacket: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer;
    open?(buffer: Buffer, nonce: Buffer, secretKey: Uint8Array): Buffer | null;
    random?(bytes: number, nonce: Buffer): Buffer;
}