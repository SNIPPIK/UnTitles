import crypto from "node:crypto";

/**
 * @author SNIPPIK
 * @description Поддерживаемые типы шифрования
 * @const Encryption
 * @private
 */
const Encryption: { name: EncryptionModes, nonce: Buffer } = {
    name: null,
    nonce: null
};

/**
 * @author SNIPPIK
 * @description Время до следующей проверки жизни
 * @const TIMESTAMP_INC
 * @private
 */
const TIMESTAMP_INC = 960;

/**
 * @author SNIPPIK
 * @description Максимальное значение int 16
 * @const MAX_16BIT
 * @private
 */
const MAX_16BIT = 2 ** 16;

/**
 * @author SNIPPIK
 * @description Максимальное значение int 32
 * @const MAX_32BIT
 * @private
 */
const MAX_32BIT = 2 ** 32;

/**
 * @author SNIPPIK
 * @description Класс для шифрования данных через библиотеки sodium или нативным способом
 * @class VoiceRTPSocket
 * @public
 */
export class VoiceRTPSocket {
    /** Пустой заголовок RTP, для использования внутри класса */
    private _RTP_HEAD = Buffer.allocUnsafe(12);

    /** Пустой буфер */
    private _nonce: Buffer = Buffer.from(Encryption.nonce);

    /** Порядковый номер пустого буфера */
    private _nonceSize : number;

    /** Последовательность opus фреймов */
    private sequence: number;

    /** Время проигрывания opus фреймов (+960) */
    private timestamp: number;

    /**
     * @description Задаем единственный актуальный вариант шифрования
     * @returns EncryptionModes
     * @public
     */
    public static get mode() {
        return Encryption.name;
    };

    /**
     * @description Buffer для режима шифрования, нужен для правильно расстановки пакетов
     * @returns Buffer
     * @public
     */
    public get nonceSize() {
        // Если по какой-то причине нет nonce буфера
        if (!this._nonce || !Encryption.nonce) {
            this._nonce = Buffer.alloc(Encryption.nonce?.length ?? 12);
        }

        // пишем счетчик в первые 4 байта (или в нужную позицию)
        this._nonce.writeUInt32BE(this._nonceSize >>> 0, 0);
        this._nonceSize = (this._nonceSize + 1) >>> 0;
        return this._nonce;
    };

    /**
     * @description Пустой пакет для внесения данных по стандарту "Voice Packet Structure"
     * @returns Buffer
     * @private
     */
    private get header() {
        if (this.sequence >= MAX_16BIT) this.sequence = 0;   // Проверяем что-бы не было превышения int 16
        if (this.timestamp >= MAX_32BIT) this.timestamp = 0; // Проверяем что-бы не было превышения int 32

        // Получаем текущий заголовок
        const RTPHead = this._RTP_HEAD;

        // Записываем новую последовательность
        RTPHead.writeUInt16BE(this.sequence, 2);
        this.sequence = (this.sequence + 1) & 0xFFFF;

        // Временная метка
        RTPHead.writeUInt32BE(this.timestamp, 4);
        this.timestamp = (this.timestamp + TIMESTAMP_INC) >>> 0;

        // SSRC
        RTPHead.writeUInt32BE(this.options.ssrc, 8);

        return RTPHead;
    };

    /**
     * @description Создаем класс
     * @param options
     * @public
     */
    public constructor(private options: EncryptorOptions) {
        this.sequence = this.randomNBit(16);
        this.timestamp = this.randomNBit(32);
        this._nonceSize = this.randomNBit(32);

        // Version + Flags, Payload Type 120 (Opus)
        [this._RTP_HEAD[0], this._RTP_HEAD[1]] = [0x80, 0x78];
    };

    /**
     * @description Задаем структуру пакета
     * @param frame - Аудио пакет OPUS
     * @returns Buffer
     * @public
     */
    public packet = (frame: Buffer) => {
        // Получаем заголовок RTP
        const RTPHead = this.header;

        // Получаем nonce буфер 12-24 бит
        const nonce = this.nonceSize;

        return this.decodeAudioBuffer(RTPHead, frame, nonce);
    };

    /**
     * @description Глубокая кодировка дает возможность шифровать из вне!
     * @param RTPHead       - Заголовок
     * @param packet        - Аудио пакет
     * @param nonce         - Размер nonce
     * @returns Buffer
     * @public
     */
    public decodeAudioBuffer = (RTPHead: Buffer, packet: Buffer, nonce?: Buffer) => {
        // Получаем тип шифрования
        const mode = VoiceRTPSocket.mode;
        if (!nonce) nonce = this.nonceSize;

        // Готовим буферы
        let encrypted: Buffer;
        let totalLength = RTPHead.length; // стартовая длина

        // Шифрование aead_aes256_gcm
        if (mode === "aead_aes256_gcm_rtpsize") {
            const cipher = crypto.createCipheriv("aes-256-gcm", this.options.key, nonce, { authTagLength: 16 });
            cipher.setAAD(RTPHead);

            const enc = cipher.update(packet);
            const fin = cipher.final();
            const tag = cipher.getAuthTag();

            totalLength += enc.length + fin.length + tag.length;
            encrypted = Buffer.allocUnsafe(enc.length + fin.length + tag.length);

            let off = 0;
            enc.copy(encrypted, off); off += enc.length;
            fin.copy(encrypted, off); off += fin.length;
            tag.copy(encrypted, off);
        }

        // Шифрование aead_xchacha20_poly1305
        else if (mode === "aead_xchacha20_poly1305_rtpsize") {
            const cryptoPacket = loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(packet, RTPHead, nonce, this.options.key);
            encrypted = cryptoPacket;
            totalLength += cryptoPacket.length;
        }

        // если появятся другие режимы
        else {
            encrypted = packet;
            totalLength += packet.length;
        }

        // Одноразовый код размера RTP: первые 4 байта
        const nonceBuffer = nonce.subarray(0, 4);
        totalLength += nonceBuffer.length;

        // Финальный результат без Buffer.concat
        const result = Buffer.allocUnsafe(totalLength);
        let offset = 0;

        RTPHead.copy(result, offset);
        offset += RTPHead.length;

        encrypted.copy(result, offset);
        offset += encrypted.length;

        nonceBuffer.copy(result, offset);

        return result;
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит
     * @param bits - Количество бит
     * @returns number
     * @private
     */
    private randomNBit = (bits: number) => {
        const size = Math.ceil(bits / 8);
        const buf = crypto.randomBytes(size);
        if (size === 2) return buf.readUInt16BE(0);
        if (size === 4) return buf.readUInt32BE(0);
        // fallback for odd sizes
        return buf.readUIntBE(0, size) % (2 ** bits);
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this._nonceSize = null;
        this._nonce = undefined;
        this.timestamp = null;
        this.sequence = null;
        this.options = null;
        this._RTP_HEAD = undefined;
    };
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
        Encryption.name = "aead_aes256_gcm_rtpsize";
        Encryption.nonce = Buffer.alloc(12);
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
        Encryption.name = "aead_xchacha20_poly1305_rtpsize";
        Encryption.nonce = Buffer.alloc(24);

        // Делаем проверку всех доступных библиотек
        for await (const name of names) {
            try {
                const library = await import(name);
                if (typeof library?.ready?.then === "function") await library.ready;
                Object.assign(loaded_lib, support_libs[name](library));
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