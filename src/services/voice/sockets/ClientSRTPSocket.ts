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
 * @class ClientSRTPSocket
 * @public
 */
export class ClientSRTPSocket {
    /**
     * @description Пустой заголовок RTP, для использования внутри класса
     * @private
     */
    private _RTP_HEAD = Buffer.alloc(12);

    /**
     * @description Пустой буфер
     * @private
     */
    private _nonce: Buffer = Encryption.nonce;

    /**
     * @description Порядковый номер пустого буфера
     * @private
     */
    private _nonceSize = 0;

    /**
     * @description Последовательность opus фреймов
     * @private
     */
    private sequence: number;

    /**
     * @description Время проигрывания opus фреймов (+960)
     * @private
     */
    private timestamp: number;

    /**
     * @description Задаем единственный актуальный вариант шифрования
     * @static
     * @public
     */
    public static get mode() {
        return Encryption.name;
    };

    /**
     * @description Buffer для режима шифрования, нужен для правильно расстановки пакетов
     * @public
     */
    public get nonceSize() {
        // Проверяем что-бы не было привышения int 32
        if (this._nonceSize > MAX_32BIT) this._nonceSize = 0;

        // Записываем в буффер
        this._nonce.writeUInt32BE(this._nonceSize, 0);

        this._nonceSize++; // Добавляем к размеру
        return this._nonce;
    };

    /**
     * @description Пустой пакет для внесения данных по стандарту "Voice Packet Structure"
     * @private
     */
    private get header() {
        if (this.sequence > MAX_16BIT) this.sequence = 0;   // Проверяем что-бы не было привышения int 16
        if (this.timestamp > MAX_32BIT) this.timestamp = 0; // Проверяем что-бы не было привышения int 32

        /** Безопасен, поскольку данные будут сразу перезаписаны */
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

        // Version + Flags, Payload Type 120 (Opus)
        [this._RTP_HEAD[0], this._RTP_HEAD[1]] = [0x80, 0x78];
    };

    /**
     * @description Задаем структуру пакета
     * @param packet - Аудио пакет OPUS
     * @public
     */
    public packet = (packet: Buffer) => {
        // Получаем заголовок RTP
        const RTPHead = this.header;

        // Получаем nonce буфер 12-24 бит
        const nonce = this.nonceSize;

        return this.decodeAudioBuffer(RTPHead, packet, nonce);
    };

    /**
     * @description Глубокая кодировка дает возможность шифровать из вне!
     * @param RTPHead       - Заголовок
     * @param packet        - Аудио пакет
     * @param nonce         - Размер nonce
     * @param authTag       - Если требуется указать свой тег авторизации
     */
    public decodeAudioBuffer = (RTPHead: Buffer, packet: Buffer, nonce?: Buffer, authTag?: Buffer) => {
        // Получаем тип шифрования
        const mode = ClientSRTPSocket.mode;

        // Получаем nonce буфер 12-24 бит
        if (!nonce) nonce = this.nonceSize;

        // Получаем первые 4 байта из буфера
        const nonceBuffer = nonce.subarray(0, 4);

        // Шифровка aead_aes256_gcm
        if (mode === "aead_aes256_gcm_rtpsize") {
            const cipher = crypto.createCipheriv("aes-256-gcm", this.options.key, nonce, { authTagLength: 16 });
            cipher.setAAD(RTPHead);

            if (authTag) {
                cipher.setAAD(authTag);
                return Buffer.concat([cipher.update(packet), cipher.final()]);
            }

            return Buffer.concat([RTPHead, cipher.update(packet), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
        }

        // Шифровка через библиотеку
        else if (mode === "aead_xchacha20_poly1305_rtpsize") {
            if (authTag) {
                return Buffer.from(loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(Buffer.concat([packet, authTag]), RTPHead, nonce, this.options.key));
            }

            const cryptoPacket = loaded_lib.crypto_aead_xchacha20poly1305_ietf_encrypt(packet, RTPHead, nonce, this.options.key);
            return Buffer.concat([RTPHead, cryptoPacket, nonceBuffer]);
        }

        // Если нет больше вариантов шифровки
        throw new Error(`[Encryption Error]: Unsupported encryption mode "${mode}".`);
    };

    /**
     * @description Возвращает случайное число, находящееся в диапазоне n бит
     * @param bits - Количество бит
     * @private
     */
    private randomNBit = (bits: number) => {
        const max = 2 ** bits;
        const size = Math.ceil(bits / 8);
        const maxGenerated = 2 ** (size * 8);
        let rand: number;

        do {
            rand = crypto.randomBytes(size).readUIntBE(0, size);
        } while (rand >= maxGenerated - (maxGenerated % max));

        return rand % max;
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @public
     */
    public destroy = () => {
        this._nonceSize = null;
        this._nonce = null;
        this.timestamp = null;
        this.sequence = null;
        this.options = null;
        this._RTP_HEAD = null;
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