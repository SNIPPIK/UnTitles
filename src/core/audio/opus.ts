import { Writable, Transform, TransformOptions, WritableOptions } from "node:stream";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Заголовок для поиска opus
 * @const OGG_MAGIC
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
const EMPTY_FRAME =  Buffer.alloc(4);

/**
 * @author SNIPPIK
 * @description Базовый класс декодера, ищет opus фрагменты в ogg потоке
 * @class BaseEncoder
 * @extends TypedEmitter<EncoderEvents>
 * @private
 */
class BaseEncoder extends TypedEmitter<EncoderEvents> {
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

        // Начинаем обработку буфера с начала
        let offset = 0;

        // Основной цикл обработки страниц в OGG-потоке
        // Цикл продолжается, пока доступно хотя бы 27 байт — минимальный размер заголовка страницы
        while (offset + 27 <= this._buffer.length) {

            // Проверяем, соответствует ли текущая позиция сигнатуре "OggS" (OGG_MAGIC)
            // Это "магическая строка", которая всегда должна быть в начале страницы
            if (!this._buffer.subarray(offset, offset + 4).equals(OGG_MAGIC)) {
                // Если не совпадает, пытаемся найти ближайшую следующую сигнатуру OGG
                const next = this._buffer.indexOf(OGG_MAGIC, offset + 1);

                // Если ничего не найдено — выходим из цикла, т.к. Не можем синхронизироваться
                if (next === -1) break;

                // Перемещаемся к найденной сигнатуре и пробуем снова
                offset = next;
                continue;
            }

            // Проверяем, доступен ли весь заголовок страницы (27 байт)
            // Бывает, что заголовок ещё не весь пришёл — тогда ждём следующих данных
            if (offset + 27 > this._buffer.length) break;

            // Байты [offset + 26] содержит количество сегментов (Lacing Table Entries)
            // Каждая запись определяет длину одного Opus-пакета (фрагмента)
            const pageSegments = this._buffer.readUInt8(offset + 26);

            // Вычисляем конец сегментной таблицы (находится сразу после заголовка)
            const segmentTableEnd = offset + 27 + pageSegments;

            // Проверяем, пришла ли вся сегментная таблица
            // Если нет — выходим, ждём следующих данных
            if (segmentTableEnd > this._buffer.length) break;

            // Извлекаем сегментную таблицу (lacing table) — массив из `pageSegments` байт
            // Каждый байт содержит длину фрагмента (от 0 до 255)
            const segmentTable = this._buffer.subarray(offset + 27, segmentTableEnd);

            // Суммируем длину всех фрагментов, чтобы получить размер payload'а
            const totalSegmentLength = segmentTable.reduce((a, b) => a + b, 0);

            // Полный размер страницы = заголовок (27), таблица (pageSegments), и payload (все фрагменты)
            const fullPageEnd = segmentTableEnd + totalSegmentLength;

            // Проверяем, получена ли вся страница
            // Если нет — выход из цикла до прихода полной страницы
            if (fullPageEnd > this._buffer.length) break;

            // Извлекаем содержимое страницы — начиная с конца таблицы и до конца страницы
            const payload = this._buffer.subarray(segmentTableEnd, fullPageEnd);

            // Передаём таблицу сегментов и payload в обработчике, который выделяет Opus-пакеты
            this._extractPackets(segmentTable, payload);

            // Смещаем offset на конец текущей страницы и продолжаем со следующей
            offset = fullPageEnd;
        }

        // После выхода из цикла: обрезаем буфер, удаляя обработанные байты
        // Это важно, чтобы избежать переполнения и сохранить только "хвост", который ещё не разобран
        if (offset > 0) this._buffer = this._buffer.subarray(offset);
    };

    /**
     * @description Функция выделяющая opus пакет для отправки и передается через событие frame
     * @param segmentTable - Буфер сегментов
     * @param payload - Данные для корректного поиска сегмента
     * @private
     */
    private _extractPackets = (segmentTable: Buffer, payload: Buffer) => {
        let currentPacket: Buffer[] = [], payloadOffset = 0;

        // Проверяем все фреймы
        for (const segmentLength of segmentTable) {
            const segment = payload.subarray(payloadOffset, payloadOffset + segmentLength);
            currentPacket.push(segment);
            payloadOffset += segmentLength;

            if (segmentLength < 255) {
                const packet = Buffer.concat(currentPacket);
                currentPacket = [];

                // Если найден заголовок
                if (isOpusHead(packet)) {
                    this.emit("head", packet);
                    continue;
                }

                // Если найден тег
                else if (isOpusTags(packet)) {
                    this.emit("tags", packet);
                    continue;
                }

                this._choiceFrame(packet);
            }
        }
    };

    /**
     * @description Что надо сделать с opus фрагментом
     * @param frame - Сам фрагмент
     * @returns void
     * @private
     */
    private _choiceFrame = (frame: Buffer) => {
        // Если еще не отправлен 1 пустой фрейм
        if (this._first) {
            this.emit("frame", SILENT_FRAME);
            this._first = false;
        }

        // Если получен обычный frame
        this.emit("frame", frame);
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
     * @constructor
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
     * @constructor
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
 * @description По строковый расчет opusHead
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
 * @description По строковый расчет opusTags
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