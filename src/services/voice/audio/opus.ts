import { Writable, Transform, TransformOptions, WritableOptions } from "node:stream";
import {TypedEmitter} from "#structures";

/**
 * @author SNIPPIK
 * @description Заголовок для поиска opus
 */
const OGG_MAGIC = Buffer.from("OggS");

/**
 * @author SNIPPIK
 * @description Когда есть перерыв в отправленных данных, передача пакета не должна просто останавливаться. Вместо этого отправьте пять кадров молчания перед остановкой, чтобы избежать непреднамеренного интерполяции Opus с последующими передачами
 * @const SILENT_FRAME
 * @public
 */
export const SILENT_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

/**
 * @author SNIPPIK
 * @description Длительность opus фрейма в ms
 * @const OPUS_FRAME_SIZE
 * @public
 */
export const OPUS_FRAME_SIZE = 20;

/**
 * @author SNIPPIK
 * @description Пустой фрейм для предотвращения чтения null
 * @const EMPTY_FRAME
 * @private
 */
const EMPTY_FRAME =  Buffer.alloc(0);

/**
 * @author SNIPPIK
 * @description Базовый класс декодера, ищет opus фрагменты в ogg потоке
 * @class BaseEncoder
 * @extends TypedEmitter<EncoderEvents>
 * @private
 */
class BaseEncoder extends TypedEmitter<EncoderEvents> {
    /**
     * @description Найден ли head заголовок
     * @private
     */
    private _head_found = false;

    /**
     * @description НАйден ли тег заголосовок
     * @private
     */
    private _tags_found = false;

    /**
     * @description Отправлен ли 1 аудио пакет
     * @private
     */
    private _first = true;

    /**
     * @description Временный буфер, для общения между функциями
     * @private
     */
    public _buffer: Buffer = EMPTY_FRAME;

    /**
     * @description Функция ищущая актуальный для взятия фрагмент
     * @private
     */
    public parseAvailablePages = (chunk: Buffer) => {
        this._buffer = Buffer.concat([this._buffer, chunk]);

        const size = this._buffer.length;
        let offset = 0;

        while (offset + 27 <= size) {
            const magic = this._buffer.subarray(offset, offset + 4);

            // Если не находим OGGs_HEAD в буфере
            if (!magic.equals(OGG_MAGIC)) {
                this.emit("error", Error(`capture_pattern is not ${OGG_MAGIC}`));
                break;
            }

            const pageSegments = this._buffer.readUInt8(offset + 26);
            const headerLength = pageSegments + 27;

            // Если заголовок больше размера фрейма
            if (offset + headerLength > size) break;

            const segmentOffset = offset + 27;
            const segmentTable = this._buffer.subarray(segmentOffset, segmentOffset + pageSegments);
            const totalSegmentLength = segmentTable.reduce((sum, val) => sum + val, 0);
            const fullPageLength = headerLength + totalSegmentLength;

            // Если вся страница больше фрейма
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
        let currentPacket: Buffer[] = [], payloadOffset = 0;

        // Проверяем все фреймы
        for (const segmentLength of segmentTable) {
            const segment = payload.subarray(payloadOffset, payloadOffset + segmentLength);
            currentPacket.push(segment);
            payloadOffset += segmentLength;

            if (segmentLength < 255) {
                const packet = Buffer.concat(currentPacket);
                currentPacket = [];

                // Если еще не найден заглосовок head
                if (!this._head_found) {
                    // Если найден заголовок
                    if (isOpusHead(packet)) {
                        this._head_found = true;

                        this.emit("head", segment);
                        continue;
                    }
                }

                // Если еще не найден заглосовок tags
                else if (!this._tags_found) {
                    // Если найден тег
                    if (isOpusTags(packet)) {
                        this._tags_found = true;

                        this.emit("tags", segment);
                        continue;
                    }
                }

                // Если еще не отправлен 1 пустой фрейм
                if (this._first) {
                    this.emit("frame", SILENT_FRAME);
                    this._first = false;
                }

                // Если получен обычный frame
                this.emit("frame", packet);
            }
        }
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @public
     */
    public emitDestroy() {
        // Отправляем пустой пакет последним
        this.emit("frame", SILENT_FRAME);

        this._first = null;
        this._buffer = null;

        super.emitDestroy();
        this.removeAllListeners();
    };
}

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus из OGG
 * @usage Только для коротких треков
 * @class BufferedEncoder
 * @extends Writable
 * @public
 */
export class BufferedEncoder extends Writable {
    /**
     * @description Базовый класс декодера
     * @private
     */
    public encoder = new BaseEncoder();

    /**
     * @description Создаем класс
     * @public
     */
    public constructor(options: WritableOptions = { autoDestroy: true }) {
        super(options);

        this.encoder.on("head", this.emit.bind(this, "head"));
        this.encoder.on("tags", this.emit.bind(this, "tags"));
        this.encoder.on("frame", this.emit.bind(this, "frame"));
    };

    /**
     * @description Функция для работы чтения
     * @protected
     */
    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        this.encoder.parseAvailablePages(chunk);
        return callback();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @param callback - Вызов ошибки
     */
    public _destroy(error: Error, callback: { (error?: Error): void }) {
        this.encoder.emitDestroy();
        this.encoder = null;

        super._destroy(error, callback);
        this.removeAllListeners();
    };
}

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus из OGG
 * @usage Для длительных треков или полноценного стрима
 * @class PipeEncoder
 * @extends Transform
 * @public
 */
export class PipeEncoder extends Transform {
    /**
     * @description Базовый класс декодера
     * @private
     */
    private encoder = new BaseEncoder();

    /**
     * @description Создаем класс
     * @public
     */
    public constructor(options: TransformOptions = { autoDestroy: true }) {
        super(Object.assign(options, { readableObjectMode: true }));

        this.encoder.on("head", this.emit.bind(this, "head"));
        this.encoder.on("tags", this.emit.bind(this, "tags"));
        this.encoder.on("frame", this.push.bind(this));
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform = (chunk: Buffer, _: any, done: () => any) => {
        this.encoder.parseAvailablePages(chunk);
        return done();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @param callback - Вызов ошибки
     */
    public _destroy(error: Error, callback: { (error?: Error): void }) {
        this.encoder.emitDestroy();
        this.encoder = null;

        super._destroy(error, callback);
        this.removeAllListeners();
    };
}

/**
 * @author SNIPPIK
 * @description Построковый расчет opusHead
 * @param packet
 */
function isOpusHead(packet: Buffer): boolean {
    // "OpusHead" в ASCII: 0x4F 0x70 0x75 0x73 0x48 0x65 0x61 0x64
    return (
        packet.length >= 8 &&
        packet[4] === 0x48 && // 'H'
        packet[5] === 0x65 && // 'e'
        packet[6] === 0x61 && // 'a'
        packet[7] === 0x64    // 'd'
    );
}

/**
 * @author SNIPPIK
 * @description Построковый расчет opusTags
 * @param packet
 */
function isOpusTags(packet: Buffer): boolean {
    // "OpusTags" в ASCII: 0x4F 0x70 0x75 0x73 0x54 0x61 0x67 0x73
    return (
        packet.length >= 8 &&
        packet[4] === 0x54 && // 'T'
        packet[5] === 0x61 && // 'a'
        packet[6] === 0x67 && // 'g'
        packet[7] === 0x73    // 's'
    );
}

/**
 * @author SNIPPIK
 * @description События для типизации декодера
 * @interface EncoderEvents
 */
interface EncoderEvents {
    /**
     * @description Получение opus фрейма заголовка
     * @param frame - head фрагмент
     */
    "head": (frame: Buffer) => void;

    /**
     * @description Получение opus фрейма тега
     * @param frame - tag фрагмент
     */
    "tags": (frame: Buffer) => void;

    /**
     * @description Получение основного opus фрейма
     * @param frame - Основной фрагмент opus потока
     */
    "frame": (frame: Buffer) => void;
}