import { Writable } from "node:stream";

/**
 * @author SNIPPIK
 * @description Заголовок для поиска opus
 */
const OGG_MAGIC = Buffer.from("OggS");

/**
 * @author SNIPPIK
 * @description Когда есть перерыв в отправленных данных, передача пакета не должна просто останавливаться. Вместо этого отправьте пять кадров молчания перед остановкой, чтобы избежать непреднамеренного интерполяции Opus с последующими передачами
 * @public
 */
export const SILENT_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

/**
 * @author SNIPPIK
 * @description Пустой фрейм для правильного поиска opus
 */
const emptyFrame =  Buffer.alloc(0);

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus из OGG
 * @class OpusEncoder
 * @extends Writable
 * @public
 */
export class OpusEncoder extends Writable {
    private _buffer: Buffer = emptyFrame;

    /**
     * @description Функция для работы чтения
     * @protected
     */
    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this._buffer = Buffer.concat([this._buffer, chunk]);
        this.parseAvailablePages();
        return callback();
    };

    /**
     * @description Функция ищущая актуальный для взятия фрагмент
     * @private
     */
    private parseAvailablePages = () => {
        const size = this._buffer.length;
        let offset = 0;

        while (offset + 27 <= size) {
            const magic = this._buffer.subarray(offset, offset + 4);

            // Если не находим OGGs_HEAD в буфере
            if (!magic.equals(OGG_MAGIC)) {
                this.emit("error", Error(`capture_pattern is not ${OGG_MAGIC}`));
                continue;
            }

            const pageSegments = this._buffer.readUInt8(offset + 26);
            const headerLength = 27 + pageSegments;

            if (offset + headerLength > size) break;

            const segmentTable = this._buffer.subarray(offset + 27, offset + 27 + pageSegments);
            const totalSegmentLength = segmentTable.reduce((sum, val) => sum + val, 0);
            const fullPageLength = headerLength + totalSegmentLength;

            if (offset + fullPageLength > size) break;

            const payload = this._buffer.subarray(offset + headerLength, offset + fullPageLength);
            this.extractPackets(segmentTable, payload);
            offset += fullPageLength;
        }

        // Оставляем непрочитанный хвост
        this._buffer = this._buffer.subarray(offset);
    };

    /**
     * @description Функция выделяющая opus пакет для отправки и передается через событие frame
     * @param segmentTable - Буфер сегментов
     * @param payload - Данные для корректного поиска сегмента
     * @private
     */
    private extractPackets = (segmentTable: Buffer, payload: Buffer) => {
        let payloadOffset = 0;
        let currentPacket: Buffer[] = [];

        for (const segmentLength of segmentTable) {
            const segment = payload.subarray(payloadOffset, payloadOffset + segmentLength);
            currentPacket.push(segment);
            payloadOffset += segmentLength;

            if (segmentLength < 255) {
                const packet = Buffer.concat(currentPacket);
                currentPacket = [];

                const packetHeader = packet.subarray(0, 8).toString();

                // Пропустить служебные данные
                if (packetHeader === "OpusHead" || packetHeader === "OpusTags") continue

                this.emit("frame", packet);
            }
        }
    };
}