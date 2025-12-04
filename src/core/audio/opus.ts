import { Writable, Transform, TransformOptions, WritableOptions } from "node:stream";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Заголовок для поиска opus
 * @const OGG_MAGIC
 * @private
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
 * @description Максимальная длина сегмента по спецификации OGG
 * @const MAX_SEGMENT_LENGTH
 * @private
 */
const MAX_SEGMENT_LENGTH = 255;

/**
 * @author SNIPPIK
 * @description Базовый класс декодера, ищет opus фрагменты в ogg потоке
 * @class BaseEncoder
 * @extends TypedEmitter<EncoderEvents>
 * @private
 */
class BaseEncoder extends TypedEmitter<EncoderEvents> {
    /** Временный буфер, для объединения буферов */
    public _buffer: Buffer = Buffer.allocUnsafe(0);

    /**
     * @description Функция ищущая актуальный для взятия фрагмент
     * @private
     */
    public parseAvailablePages = (chunk: Buffer) => {
        const prev = this._buffer;
        let frame: Buffer;

        if (prev.length === 0) frame = chunk;
        else {
            frame = Buffer.allocUnsafe(prev.length + chunk.length);
            prev.copy(frame, 0);
            chunk.copy(frame, prev.length);
        }

        // Начинаем обработку буфера с начала
        const size = frame.length;
        let offset = 0;

        // Основной цикл обработки страниц в OGG-потоке
        // Цикл продолжается, пока доступно хотя бы 27 байт — минимальный размер заголовка страницы
        while (offset + 27 <= size) {
            // Проверяем, соответствует ли текущая позиция сигнатуре "OggS" (OGG_MAGIC)
            // Это "магическая строка", которая всегда должна быть в начале страницы
            if (frame[offset] !== OGG_MAGIC[0] ||
                frame[offset + 1] !== OGG_MAGIC[1] ||
                frame[offset + 2] !== OGG_MAGIC[2] ||
                frame[offset + 3] !== OGG_MAGIC[3]) {
                // Если не совпадает, пытаемся найти ближайшую следующую сигнатуру OGG
                const next = frame.indexOf(OGG_MAGIC, offset + 1);

                // Если ничего не найдено — выходим из цикла, т.к. Не можем синхронизироваться
                if (next === -1) break;

                // Перемещаемся к найденной сигнатуре и пробуем снова
                offset = next;
                continue;
            }

                // Проверяем, доступен ли весь заголовок страницы (27 байт)
            // Бывает, что заголовок ещё не весь пришёл — тогда ждём следующих данных
            else if (offset + 27 > size) break;

            // Байты [offset + 26] содержит количество сегментов (Lacing Table Entries)
            // Каждая запись определяет длину одного Opus-пакета (фрагмента)
            const pageSegments = frame.readUInt8(offset + 26);
            const headerLength = 27 + pageSegments;

            // Проверяем, пришла ли вся сегментная таблица
            // Если нет — выходим, ждём следующих данных
            if (offset + headerLength > size) break;

            // Проверяем, получена ли вся страница
            // Если нет — выход из цикла до прихода полной страницы
            let totalSegmentLength = 0;
            const segmentTableStart = offset + 27;
            const segmentTableEnd = segmentTableStart + pageSegments;

            for (let i = segmentTableStart; i < segmentTableEnd; i++) {
                totalSegmentLength += frame[i];
            }

            const fullPageLength = headerLength + totalSegmentLength;

            // Извлекаем содержимое страницы — начиная с конца таблицы и до конца страницы
            if (offset + fullPageLength > size) break;

            // Передаём таблицу сегментов и payload в обработчике, который выделяет Opus-пакеты
            const segmentTable = frame.subarray(segmentTableStart, segmentTableEnd);
            const payload = frame.subarray(offset + headerLength, offset + fullPageLength);
            this.extractPackets(segmentTable, payload);

            // Смещаем offset на конец текущей страницы и продолжаем со следующей
            offset += fullPageLength;
        }

        // После выхода из цикла: обрезаем буфер, удаляя обработанные байты
        // Это важно, чтобы избежать переполнения и сохранить только "хвост", который ещё не разобран
        this._buffer = frame.subarray(offset);
    };

    /**
     * @description Функция выделяющая opus пакет для отправки и передается через событие frame
     * @param segmentTable - Буфер сегментов
     * @param payload - Данные для корректного поиска сегмента
     * @private
     */
    private extractPackets = (segmentTable: Buffer, payload: Buffer) => {
        let packetStart = 0;
        let packetLength = 0;

        // Ищем нужный opus frame
        for (let i = 0; i < segmentTable.length; i++) {
            const segmentLength = segmentTable[i];
            packetLength += segmentLength;

            if (segmentLength < MAX_SEGMENT_LENGTH) {
                // Пакет завершён — отправляем одним куском
                const packet = payload.subarray(packetStart, packetStart + packetLength);
                this._emitting(packet);
                packetStart += packetLength;
                packetLength = 0;
            }
        }
    };

    /**
     * @description Обрабатываем аудио пакет
     * @param packet - Аудио пакет
     * @private
     */
    private _emitting = (packet: Buffer) => {
        // Обрабатываем пакет
        if (isOpusHead(packet)) this.emit("head", packet);
        else if (isOpusTags(packet)) this.emit("tags", packet);
        else this.emit("frame", packet);
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @public
     */
    public destroy() {
        this._buffer.fill(0);
        this._buffer = null;

        // Освобождаем emitter
        this.removeAllListeners();
        super.destroy();
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
     * @constructor
     * @public
     */
    public constructor(options: WritableOptions = { autoDestroy: true }) {
        super(options);
        this.encoder.on("frame", this.emit.bind(this, "frame"));
        this.encoder.on("head", (frame) => this.emit("head", frame));
        this.encoder.on("tags", (frame) => this.emit("tags", frame));
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
     * @public
     */
    public _destroy(error: Error) {
        this.encoder.destroy();
        this.encoder = null;

        this.removeAllListeners();
        super.destroy(error);
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
     * @constructor
     * @public
     */
    public constructor(options: TransformOptions = { autoDestroy: true }) {
        super(Object.assign(options, { readableObjectMode: true }));
        this.encoder.on("frame", this.push.bind(this));
        this.encoder.on("head", (frame) => this.emit("head", frame));
        this.encoder.on("tags", (frame) => this.emit("tags", frame));
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
     * @public
     */
    public _destroy(error: Error) {
        this.encoder.destroy();
        this.encoder = null;

        this.removeAllListeners();
        super.destroy(error);
    };
}


/**
 * @author SNIPPIK
 * @description По строковый расчет opusHead
 * @param packet
 * @private
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
 * @description По строковый расчет opusTags
 * @param packet
 * @private
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
 * @private
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