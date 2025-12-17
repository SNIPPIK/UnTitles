import { VoiceConnection } from "#core/voice";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Размер тега авторизации
 * @const AUTH_TAG_LENGTH
 * @private
 */
const AUTH_TAG_LENGTH = 16;

/**
 * @author SNIPPIK
 * @description Размер nonce
 * @const UNPADDED_NONCE_LENGTH
 * @private
 */
const UNPADDED_NONCE_LENGTH = 4;

/**
 * @author SNIPPIK
 * @description Заголовок discord receive
 * @const HEADER_EXTENSION_BYTE
 * @private
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
     * @public
     */
    public constructor(private readonly voice: VoiceConnection) {
        super();

        // Задаем SSRC
        voice.websocket.on("speaking", ({d}) => {
            this.ssrc = d.ssrc;
        });

        // Если подключается новый пользователь
        voice.websocket.on("ClientConnect", ({d}) => {
            this._users = d.user_ids;
        });

        // Если отключается пользователь
        voice.websocket.on("ClientDisconnect", ({d}) => {
            const index = this._users.indexOf(d.user_id);

            // Если есть пользователь
            if (index !== -1) {
                this._users.splice(index, 1);
            }
        });

        // Слушаем UDP подключение
        voice.udp.on("message", (message) => {
            // Если сообщение меньше размера SSRC
            if (message.length <= 8) return;

            const ssrc = message.readUInt32BE(8);

            if (this.ssrc === ssrc) {
                // Копируем последние 4 байта незаполненного одноразового значения в заполнение (12 - 4) или (24 - 4) байтов.
                message.copy(voice.sRTP["_nonceBuffer"], 0, message.length - UNPADDED_NONCE_LENGTH);
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

        // Незашифрованный заголовок RTP содержит 12 байт, HEADER_EXTENSION и размер расширения
        const header = buffer.subarray(0, headerSize);

        // Зашифрованный файл содержит расширение, если таковое имеется, пакет opus и тег аутентификации.
        const encrypted = buffer.subarray(headerSize, buffer.length - AUTH_TAG_LENGTH - UNPADDED_NONCE_LENGTH);
        /*
        const authTag = buffer.subarray(
            buffer.length - AUTH_TAG_LENGTH - UNPADDED_NONCE_LENGTH,
            buffer.length - UNPADDED_NONCE_LENGTH,
        );
         */

        let packet = this.voice.sRTP.packet(Buffer.concat([header, encrypted, this.voice.sRTP["_nonce"]]));

        // Если нет аудио
        if (!packet) return null;

        // Удалить расшифрованное расширение заголовка RTP, если присутствует
        // Заголовок указан только в исходных данных, поэтому сначала надо сравнить с буфером
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
 * @private
 */
interface VoiceReceiverEvents {
    /**
     * @description Событие когда говорит пользователь
     * @param ids - IDs всех говорящих пользователей
     * @param ssrc - SSRC сессии
     * @param audio - Аудио пакет от пользователя
     * @warn Аудио пока не работает!
     */
    "speaking": (ids: string[], ssrc: number, audio: Buffer) => void;
}