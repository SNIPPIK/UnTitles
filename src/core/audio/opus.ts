import { Transform, TransformOptions, Writable, WritableOptions } from "node:stream";
import { OggOpusParser } from "#native/opus";

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
        // Твои стандартные бинды
        this.parser.on("frame", (frame) => this.emit("frame", frame));
        this.parser.on("head", (frame) => this.emit("head", frame));
        this.parser.on("tags", (frame) => this.emit("tags", frame));
        this.parser.on("error", (err) => this.emit("error", err));
    };

    /**
     * @description Функция для работы чтения
     * @protected
     */
    public _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
        this.parser.parseAvailablePages(chunk);
        callback();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @param callback
     * @public
     */
    public _destroy(error: Error | null, callback: (error: Error | null) => void) {
        if (this.parser) {
            this.parser.destroy();
            this.parser = null as any;
        }

        this.removeAllListeners();
        super.destroy(error || undefined);
        callback(error);
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
        super(Object.assign(options, {
            readableObjectMode: true,
            writableObjectMode: false, // На вход буферы, на выход объекты (кадры)
            autoDestroy: true
        }));

        // Маппим кадры напрямую в поток через push
        this.parser.on("frame", (frame) => this.push(frame));
        this.parser.on("head", (frame) => this.emit("head", frame));
        this.parser.on("tags", (frame) => this.emit("tags", frame));
        this.parser.on("error", (err) => this.emit("error", err));
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform(chunk: Buffer, _: any, done: () => any) {
        this.parser.parseAvailablePages(chunk);
        done();
    };

    /**
     * @description Удаляем неиспользуемые данные
     * @param error - Ошибка
     * @param callback -
     * @public
     */
    public _destroy(error: Error | null, callback: (error: Error | null) => void) {
        if (this.parser) {
            this.parser.destroy();
            this.parser = null as any;
        }
        this.removeAllListeners();
        super.destroy(error || undefined);
        callback(error);
    };
}