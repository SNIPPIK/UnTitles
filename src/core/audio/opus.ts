import { Transform, TransformOptions, Writable, WritableOptions } from "node:stream";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Вспомогательная функция для создания буфера из строки
 * @const fromString
 * @private
 */
const fromString = (str: string): Buffer => Buffer.from(str);

/**
 * @author SNIPPIK
 * @description Константы и сигнатуры Ogg/Opus
 * @const OGG_CONSTANTS
 * @private
 */
const OGG_CONSTANTS = {
    // Магическая сигнатура "OggS"
    CAPTURE_PATTERN: fromString("OggS"),
    // Заголовки Opus
    OPUS_HEAD: fromString("OpusHead"),
    OPUS_TAGS: fromString("OpusTags"),
    // Размеры фиксированных частей заголовка
    PAGE_HEADER_SIZE: 27,
    // Смещения в заголовке Ogg
    OFFSET_VERSION: 4,
    OFFSET_TYPE: 5,
    OFFSET_GRANULE: 6,
    OFFSET_SERIAL: 14,
    OFFSET_SEQ: 18,
    OFFSET_CRC: 22,
    OFFSET_SEGMENTS_COUNT: 26,
    OFFSET_SEGMENT_TABLE: 27,
};


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
 * @description Базовый класс декодера, ищет opus фрагменты в ogg потоке
 * @class BaseEncoder
 * @extends TypedEmitter<EncoderEvents>
 * @private
 */
class OggOpusParser extends TypedEmitter<EncoderEvents> {
    /** Остаток данных от предыдущего фрейма, который не удалось обработать */
    private _remainder: Buffer | null = null;

    /** Серийный номер битового потока, к которому мы "привязались" */
    private _bitstreamSerial: number | null = null;

    /**
     * @description Функция ищущая актуальный для взятия фрагмент
     * @public
     */
    public parseAvailablePages = (chunk: Buffer) => {
        // Объединяем входящий фрейм с остатком от предыдущего (если есть)
        let buffer = this._remainder ? Buffer.concat([this._remainder, chunk]) : chunk;

        let offset = 0;
        const totalLength = buffer.length;

        // 2. Цикл обработки страниц Ogg внутри буфера
        while (true) {
            // Проверка: хватает ли данных хотя бы на минимальный заголовок страницы (27 байт)
            if (totalLength - offset < OGG_CONSTANTS.PAGE_HEADER_SIZE) {
                break;
            }

            // Проверка сигнатуры "OggS"
            // Мы используем subarray для сравнения без копирования памяти
            if (!buffer.subarray(offset, offset + 4).equals(OGG_CONSTANTS.CAPTURE_PATTERN)) {
                // Критическая ошибка: потеряна синхронизация или неверный формат.
                // В продакшене можно попробовать найти следующее вхождение "OggS" (resync),
                // но для простоты выбрасываем ошибку.
                this.emit("error", new Error("OggS capture pattern not found. Stream might be corrupted."));
                return;
            }

            // Читаем версию структуры (должна быть 0)
            const version = buffer.readUInt8(offset + OGG_CONSTANTS.OFFSET_VERSION);
            if (version !== 0) {
                this.emit("error", new Error(`Unsupported Ogg stream structure version: ${version}`));
                return;
            }

            // Получаем количество сегментов в этой странице
            const pageSegmentsCount = buffer.readUInt8(offset + OGG_CONSTANTS.OFFSET_SEGMENTS_COUNT);

            // Проверка: хватает ли данных на таблицу сегментов
            // Заголовок (27) + Таблица сегментов (N байт)
            if (totalLength - offset < OGG_CONSTANTS.PAGE_HEADER_SIZE + pageSegmentsCount) {
                break;
            }

            // Читаем таблицу сегментов (Lacing values) для расчета размера данных
            let pageDataSize = 0;
            const segmentTableStart = offset + OGG_CONSTANTS.PAGE_HEADER_SIZE;

            for (let i = 0; i < pageSegmentsCount; i++) {
                pageDataSize += buffer.readUInt8(segmentTableStart + i);
            }

            // Полный размер страницы = Заголовок + Таблица сегментов + Сами данные
            const totalPageSize = OGG_CONSTANTS.PAGE_HEADER_SIZE + pageSegmentsCount + pageDataSize;

            // Проверка: загружена ли вся страница целиком?
            if (totalLength - offset < totalPageSize) {
                break;
            }

            // --- ОБРАБОТКА СТРАНИЦЫ ---

            // Проверяем Serial Number. Если это первая страница, запоминаем его.
            const serial = buffer.readUInt32BE(offset + OGG_CONSTANTS.OFFSET_SERIAL);

            if (this._bitstreamSerial === null) this._bitstreamSerial = serial;
            else if (this._bitstreamSerial !== serial) {
                // Это страница из другого логического потока (мультиплексирование), пропускаем её
                offset += totalPageSize;
                continue;
            }

            // Извлекаем пакеты данных
            let dataStart = segmentTableStart + pageSegmentsCount;
            let packetSize = 0;

            // Итерируемся по таблице сегментов снова, чтобы собрать пакеты
            for (let i = 0; i < pageSegmentsCount; i++) {
                const segmentSize = buffer.readUInt8(segmentTableStart + i);
                packetSize += segmentSize;

                // Если размер сегмента < 255, это конец логического пакета
                if (segmentSize < 255) {
                    const packet = buffer.subarray(dataStart, dataStart + packetSize);
                    this.extractPackets(packet);

                    // Сдвигаем указатель данных на следующий пакет
                    dataStart += packetSize;
                    packetSize = 0;
                }
            }

            // Сдвигаем глобальный offset на размер обработанной страницы
            offset += totalPageSize;
        }

        // Сохраняем необработанный остаток для следующего вызова
        if (offset < totalLength) {
            // Копируем остаток в новый буфер, чтобы не удерживать ссылку на огромный старый chunk
            this._remainder = Buffer.from(buffer.subarray(offset));
        }
    };

    /**
     * @description Обработка и маршрутизация извлеченного пакета
     * @param packet - Аудио данные
     * @private
     */
    private extractPackets(packet: Buffer): void {
        // Защита от пустых пакетов
        if (packet.length < 8) {
            return;
        }

        const signature = packet.subarray(0, 8);

        // Проверяем сигнатуру является ли это заголовок
        if (signature.equals(OGG_CONSTANTS.OPUS_HEAD)) {
            // Мы не пушим OpusHead в readable аудио данных, обычно это метаданные.
            this.emit("head", packet);
        } else if (signature.equals(OGG_CONSTANTS.OPUS_TAGS)) {
            // Теги комментариев
            this.emit("tags", packet);
        } else {
            // Это аудио данные. Отправляем дальше.
            // Обычно первый пакет после заголовков должен быть отправлен.
            this.emit("frame", packet);
        }
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @public
     */
    public destroy() {
        this.emit("frame", SILENT_FRAME);

        this._remainder = null;
        this._bitstreamSerial = null;

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
    public parser = new OggOpusParser();

    /**
     * @description Создаем класс
     * @constructor
     * @public
     */
    public constructor(options: WritableOptions = { autoDestroy: true }) {
        super(options);
        this.parser.on("frame", this.emit.bind(this, "frame"));
        this.parser.on("head", (frame) => this.emit("head", frame));
        this.parser.on("tags", (frame) => this.emit("tags", frame));
        this.parser.on("error", (err) => this.emit("error", err));
    };

    /**
     * @description Функция для работы чтения
     * @protected
     */
    public async _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.parser.parseAvailablePages(chunk);
        return callback();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @public
     */
    public _destroy(error: Error) {
        this.parser.destroy();
        this.parser = null;

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
    private parser = new OggOpusParser();

    /**
     * @description Создаем класс
     * @constructor
     * @public
     */
    public constructor(options: TransformOptions = { autoDestroy: true }) {
        super(Object.assign(options, { readableObjectMode: true }));
        this.parser.on("frame", this.push.bind(this));
        this.parser.on("head", (frame) => this.emit("head", frame));
        this.parser.on("tags", (frame) => this.emit("tags", frame));
        this.parser.on("error", (err) => this.emit("error", err));
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform = async (chunk: Buffer, _: any, done: () => any) => {
        this.parser.parseAvailablePages(chunk);
        return done();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @public
     */
    public _destroy(error: Error) {
        this.parser.destroy();
        this.parser = null;

        this.removeAllListeners();
        super.destroy(error);
    };
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

    /**
     * @description Получение ошибки при конвертировании аудио
     * @param error - ошибка
     */
    "error": (error: Error) => void;
}