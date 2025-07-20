import { VoiceConnection } from "#service/voice";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Размер тега авторизации
 * @const AUTH_TAG_LENGTH
 */
const AUTH_TAG_LENGTH = 16;

/**
 * @author SNIPPIK
 * @description Размер nonce
 * @const UNPADDED_NONCE_LENGTH
 */
const UNPADDED_NONCE_LENGTH = 4;

/**
 * @author SNIPPIK
 * @description Заголовок discord receive
 * @const HEADER_EXTENSION_BYTE
 */
const HEADER_EXTENSION_BYTE = Buffer.from([0xbe, 0xde]);

/**
 * @author SNIPPIK
 * @description Класс слушателя, требуется для отслеживания прослушиваний со стороны пользователей
 * @class VoiceReceiver
 * @extends TypedEmitter
 * @public
 */
export class VoiceReceiver extends TypedEmitter<VoiceReceiverEvents> {
    /**
     * @description SSRC пользователя
     * @private
     */
    private ssrc: number = 0;

    /**
     * @description Пользователя которых надо слушать
     * @readonly
     * @private
     */
    private _users: string[];

    /**
     * @description Запуск класса слушателя, для прослушивания пользователей
     * @param voice - Голосове подключение
     * @constructor
     */
    public constructor(private readonly voice: VoiceConnection) {
        super();

        // Задаем SSRC
        voice["websocket"].on("speaking", ({d}) => {
            this.ssrc = d.ssrc;
        });

        // Если подключается новый пользователь
        voice["websocket"].on("ClientConnect", ({d}) => {
            this._users = d.user_ids;
        });

        // Если отключается пользователь
        voice["websocket"].on("ClientDisconnect", ({d}) => {
            const index = this._users.indexOf(d.user_id);

            // Если есть пользователь
            if (index !== -1) {
                this._users.splice(index, 1);
            }
        });

        // Слушаем UDP подключение
        voice["clientUDP"].on("message", (message) => {
            // Если сообщение меньше размера SSRC
            if (message.length <= 8) return;

            const ssrc = message.readUInt32BE(8);

            if (this.ssrc === ssrc) {
                // Copy the last 4 bytes of unpadded nonce to the padding of (12 - 4) or (24 - 4) bytes
                message.copy(voice["clientSRTP"]["_nonceBuffer"], 0, message.length - UNPADDED_NONCE_LENGTH);
                const audio = this.parsePacket(message);

                this.emit("speaking", this._users, ssrc, audio);
                return;
            }
        });
    };

    /**
     * @description Обрабатываем полученный аудио пакет по UDP
     * @param buffer - Полученный аудио фрейм
     * @returns Buffer
     * @private
     */
    private parsePacket = (buffer: Buffer) => {
        let headerSize = 12;
        const first = buffer.readUint8();
        if ((first >> 4) & 0x01) headerSize += 4;

        // The unencrypted RTP header contains 12 bytes, HEADER_EXTENSION and the extension size
        const header = buffer.subarray(0, headerSize);

        // Encrypted contains the extension, if any, the opus packet, and the auth tag
        const encrypted = buffer.subarray(headerSize, buffer.length - AUTH_TAG_LENGTH - UNPADDED_NONCE_LENGTH);
        const authTag = buffer.subarray(
            buffer.length - AUTH_TAG_LENGTH - UNPADDED_NONCE_LENGTH,
            buffer.length - UNPADDED_NONCE_LENGTH,
        );

        let packet = this.voice["clientSRTP"].decodeAudioBuffer(header, encrypted, this.voice["clientSRTP"]["_nonce"], authTag);

        // Если нет аудио
        if (!packet) return null;

        // Strip decrypted RTP Header Extension if present
        // The header is only indicated in the original data, so compare with buffer first
        if (buffer.subarray(12, 14).compare(HEADER_EXTENSION_BYTE) === 0) {
            const headerExtensionLength = buffer.subarray(14).readUInt16BE();
            packet = packet.subarray(4 * headerExtensionLength);
        }

        return packet;
    };
}

/**
 * @author SNIPPIK
 * @description События слушателя
 * @interface VoiceReceiverEvents
 */
interface VoiceReceiverEvents {
    "speaking": (ids: string[], ssrc: number, audio: Buffer) => void;
}