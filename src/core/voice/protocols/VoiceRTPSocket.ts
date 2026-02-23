import crypto from "node:crypto";

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
    private head = Buffer.allocUnsafe(12);

    /** Пустой буфер */
    private _nonceBuffer: Buffer = Buffer.alloc(12);

    /** Порядковый номер пустого буфера */
    public _nonce : number;

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
        return "aead_aes256_gcm_rtpsize";
    };

    /**
     * @description Buffer для режима шифрования, нужен для правильно расстановки пакетов
     * @returns Buffer
     * @public
     */
    public get nonce() {
        if (this._nonce >= MAX_32BIT) this._nonce = 0;

        this._nonceBuffer.writeUInt32BE(this._nonce, 0);
        this._nonce++;

        return this._nonceBuffer;
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
        const RTPHead = this.head;

        // Записываем новую последовательность
        RTPHead.writeUInt16BE(this.sequence, 2);
        this.sequence++;

        // Временная метка
        RTPHead.writeUInt32BE(this.timestamp, 4);
        this.timestamp += TIMESTAMP_INC;

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
        this.sequence = randomNBit(16);
        this.timestamp = randomNBit(32);
        this._nonce = randomNBit(32);

        // Version + Flags, Payload Type 120 (Opus)
        [this.head[0], this.head[1]] = [0x80, 0x78];
    };

    /**
     * @description Задаем структуру пакета
     * @param frame - Аудио пакет OPUS
     * @returns Buffer
     * @public
     */
    public packet = (frame: Buffer) => {
        const head = this.header;
        const nonce = this.nonce;
        const key = this.options.key;

        // Получаем первые 4 байта из буфера
        const nonceBuffer = nonce.subarray(0, 4);
        const cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);

        // !! ВАЖНО !!: Устанавливаем заголовок RTP (head) как AAD (Associated Data).
        // Это гарантирует, что RTP-заголовок будет аутентифицирован (защищен от подделки),
        // но не зашифрован, что соответствует SRTP.
        cipher.setAAD(head);
        return Buffer.concat([head, cipher.update(frame), cipher.final(), cipher.getAuthTag(), nonceBuffer]);
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this._nonce = null;
        this.timestamp = null;
        this.sequence = null;
        this.options = null;
        this._nonceBuffer = null;
        this.head = null;
    };
}

/**
 * @author SNIPPIK
 * @description Возвращает случайное число, находящееся в диапазоне n бит
 * @param bits - Количество бит
 * @returns number
 * @private
 */
function randomNBit(bits: number){
    return crypto.randomInt(0, 1 << bits);
}

/**
 * @author SNIPPIK
 * @description Параметры для шифрования
 * @interface EncryptorOptions
 * @public
 */
export interface EncryptorOptions {
    ssrc: number;
    key: Uint8Array;
}