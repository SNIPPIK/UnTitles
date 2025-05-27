import crypto from "crypto";

/**
 * @author SNIPPIK
 * @description Поддерживаемые типы шифрования
 * @private
 */
const EncryptionModes: EncryptionModes[] = [];

/**
 * @author SNIPPIK
 * @description Поддерживающие размеры начальных пакетов
 */
const EncryptionNonce: Buffer[] = [];

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
const TIMESTAMP_INC = 960;

/**
 * @author SNIPPIK
 * @description Класс для шифрования данных через библиотеки sodium или нативным способом
 * @class ClientRTPSocket
 * @public
 */
export class ClientRTPSocket {
    /**
     * @description Пустой буфер
     * @private
     */
    private readonly _nonceBuffer: Buffer = EncryptionNonce[0];

    /**
     * @description Порядковый номер пустого буфера
     * @private
     */
    private _nonce = 0;

    /**
     * @description
     * @private
     */
    private sequence: number;

    /**
     * @description Время прошлого аудио пакета
     * @private
     */
    private timestamp: number;

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
    public get nonce() {
        this._nonce++;

        // Если нет пакета или номер пакет превышен максимальный, то его надо сбросить
        if (this._nonce >= MAX_NONCE_SIZE) this._nonce = 0;
        this._nonceBuffer.writeUInt32BE(this._nonce, 0);

        return this._nonceBuffer;
    };

    /**
     * @description Пустой пакет для внесения данных по стандарту "Voice Packet Structure"
     * @public
     */
    private get rtp_packet() {
        // Unsafe является безопасным поскольку данные будут перезаписаны
        const rtp_packet = Buffer.allocUnsafe(12);
        // Version + Flags, Payload Type
        [rtp_packet[0], rtp_packet[1]] = [0x80, 0x78];

        // Последовательность
        rtp_packet.writeUInt16BE(this.sequence, 2);

        // Временная метка
        rtp_packet.writeUInt32BE(this.timestamp, 4);

        // SSRC
        rtp_packet.writeUInt32BE(this.options.ssrc, 8);

        return rtp_packet;
    };

    /**
     * @description Создаем класс
     * @param options
     */
    public constructor(private options: EncryptorOptions) {
        this.sequence = this.randomNBit(16);
        this.timestamp = this.randomNBit(32);
    };

    /**
     * @description Задаем структуру пакета
     * @param packet - Пакет Opus для шифрования
     * @public
     */
    public packet = (packet: Buffer) => {
        this.sequence++;
        this.timestamp += TIMESTAMP_INC;

        if (this.sequence >= 2 ** 16) this.sequence = 0;
        if (this.timestamp >= 2 ** 32) this.timestamp = 0;

        return this.crypto(packet);
    };

    /**
     * @description Подготавливаем пакет к отправке, выставляем правильную очередность
     * @param packet - Пакет Opus для шифрования
     * @private
     */
    private crypto = (packet: Buffer): Buffer => {
        const nonceBuffer = this._nonceBuffer.subarray(0, 4);

        const mode = ClientRTPSocket.mode;
        const rtp = this.rtp_packet;
        const nonce = this.nonce

        // Шифровка aead_aes256_gcm (support rtpsize)
        if (mode === "aead_aes256_gcm_rtpsize") {
            const cipher = crypto.createCipheriv("aes-256-gcm", this.options.key, nonce);
            cipher.setAAD(rtp);
            return Buffer.concat([rtp, cipher.update(packet), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
        }

        // Шифровка через библиотеку
        else if (mode === "aead_xchacha20_poly1305_rtpsize") {
            const cryptoPacket = loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(packet, rtp, nonce, this.options.key);
            return Buffer.concat([rtp, cryptoPacket, nonceBuffer]);
        }

        // Если нет больше вариантов шифровки
        throw new Error(`[Encryption Error]: Unsupported encryption mode "${mode}".`);
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит
     * @param bits - Количество бит
     * @private
     */
    private randomNBit = (bits: number) => crypto.randomBytes(Math.ceil(bits / 8)).readUIntBE(0, Math.ceil(bits / 8)) % (2 ** bits);
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
    // Если поддерживается нативная расшифровка
    if (crypto.getCiphers().includes("aes-256-gcm")) {
        EncryptionModes.push("aead_aes256_gcm_rtpsize");
        EncryptionNonce.push(Buffer.alloc(12));
        return;
    }

    // Если нет нативной поддержки шифрования
    else {
        /**
         * @author SNIPPIK
         * @description Поддерживаемые библиотеки
         */
        const support_libs: Methods.supported = {
            sodium: (lib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt:(plaintext: Buffer, additionalData: Buffer, nonce: Buffer, key: ArrayBufferLike) => {
                    return lib.api.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, null, nonce, key);
                }
            }),
            "sodium-native": (lib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt:(plaintext, additionalData, nonce, key) => {
                    const cipherText = Buffer.alloc(plaintext.length + lib.crypto_aead_xchacha20poly1305_ietf_ABYTES);
                    lib.crypto_aead_xchacha20poly1305_ietf_encrypt(cipherText, plaintext, additionalData, null, nonce, key);
                    return cipherText;
                }
            }),
            "@stablelib/xchacha20poly1305": (lib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt(cipherText, additionalData, nonce, key) {
                    const crypto = new lib.XChaCha20Poly1305(key);
                    return crypto.seal(nonce, cipherText, additionalData);
                },
            }),
            "@noble/ciphers/chacha": (lib) => ({
                crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, additionalData, nonce, key) {
                    const chacha = lib.xchacha20poly1305(key, nonce, additionalData);
                    return chacha.encrypt(plaintext);
                },
            })
        }, names = Object.keys(support_libs);

        // Добавляем тип шифрования
        EncryptionModes.push("aead_xchacha20_poly1305_rtpsize");
        EncryptionNonce.push(Buffer.alloc(24));

        // Делаем проверку всех доступных библиотек
        for (const name of names) {
            try {
                const library = await import(name);
                if (typeof library?.ready?.then === "function") await library.ready;
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

/**
 * @author SNIPPIK
 * @description Параметры для шифрования
 */
export interface EncryptorOptions {
    ssrc: number;
    key: Uint8Array;
}