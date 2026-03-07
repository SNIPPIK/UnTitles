import { OPUS_FRAME_SIZE } from "#core/audio";
import crypto from "node:crypto";

/**
 * @author SNIPPIK
 * @description Время фрейм симпла
 * @const TIMESTAMP_INC
 * @private
 */
const TIMESTAMP_INC = Math.round(48000 * (OPUS_FRAME_SIZE / 1000));

/**
 * @author SNIPPIK
 * @description Максимальное значение int 16
 * @const MAX_16BIT
 * @private
 */
const MAX_16BIT = 0xFFFF;

/**
 * @author SNIPPIK
 * @description Класс для шифрования данных через библиотеки sodium или нативным способом
 * @class VoiceRTPSocket
 * @public
 */
export class VoiceRTPSocket {
    /** Порядковый номер пустого буфера */
    public counter : number;

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
        const nonce = Buffer.allocUnsafe(12);

        nonce.writeUInt32BE(this.counter >>> 0, 0);
        nonce.fill(0, 4);

        const tail = nonce.subarray(0, 4);
        this.counter = (this.counter + 1) >>> 0;

        return { nonce, tail };
    };

    /**
     * @description Пустой пакет для внесения данных по стандарту "Voice Packet Structure"
     * @returns Buffer
     * @private
     */
    private get header() {
        const header = Buffer.allocUnsafe(12);

        // Version(2) + Padding(0) + Extension(0) + CC(0)
        header[0] = 0x80;

        // Marker(0) + Payload type (120 = Opus)
        header[1] = 0x78;

        // Записываем новую последовательность
        header.writeUInt16BE(this.sequence, 2);

        // Временная метка
        header.writeUInt32BE(this.timestamp, 4);

        // SSRC
        header.writeUInt32BE(this.options.ssrc, 8);

        // Increment counters (with wrap)
        this.sequence = (this.sequence + 1) & MAX_16BIT;
        this.timestamp = (this.timestamp + TIMESTAMP_INC) >>> 0;

        return header;
    };

    /**
     * @description Создаем класс
     * @param options
     * @public
     */
    public constructor(private options: EncryptorOptions) {
        this.sequence = randomNBit(16);
        this.timestamp = randomNBit(32);
        this.counter = randomNBit(32);
    };

    /**
     * @description Задаем структуру пакета
     * @param frame - Аудио пакет OPUS
     * @returns Buffer
     * @public
     */
    public packet = (frame: Buffer) => {
        const header = this.header;
        const { nonce, tail } = this.nonce;

        const cipher = crypto.createCipheriv(
            "aes-256-gcm",
            this.options.key,
            nonce
        );

        // Устанавливаем заголовок RTP (head) как AAD (Associated Data).
        cipher.setAAD(header);

        const encrypted = Buffer.concat([
            cipher.update(frame),
            cipher.final()
        ]);

        const tag = cipher.getAuthTag();

        // Layout:
        // [RTP header][ciphertext][auth tag][nonce(4 bytes)]
        return Buffer.concat([
            header,
            encrypted,
            tag,
            tail
        ]);
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this.timestamp = null;
        this.sequence = null;
        this.options = null;
        this.counter = null;
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
    const bytes = Math.ceil(bits / 8);
    const buf = crypto.randomBytes(bytes);
    return buf.readUIntBE(0, bytes);
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