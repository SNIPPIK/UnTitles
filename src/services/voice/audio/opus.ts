import {PassThrough} from "node:stream";
import {Buffer} from "node:buffer";
import {Logger} from "@utils";

/**
 * @author SNIPPIK
 * @description Превращаем имя переменной в буфер
 * @param name - Имя переменной
 * @private
 */
const bufferCode = (name: string) => {
    return Buffer.from([...`${name}`].map((x: string) => x.charCodeAt(0)));
};

/**
 * @author SNIPPIK
 * @description Заголовки для поиска в chuck
 * @private
 */
const OGG = {
    "OGGs_HEAD": bufferCode("OggS"),
    "OPUS_HEAD": bufferCode("OpusHead"),
    "OPUS_TAGS": bufferCode("OpusTags")
};

/**
 * @author SNIPPIK
 * @description Когда есть перерыв в отправленных данных, передача пакета не должна просто останавливаться. Вместо этого отправьте пять кадров молчания перед остановкой, чтобы избежать непреднамеренного интерполяции Opus с последующими передачами
 * @public
 */
export const SILENT_FRAME = Buffer.from([0xF8, 0xFF, 0xFE]);

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 * @extends PassThrough
 * @public
 */
export class OpusEncoder extends PassThrough {
    /**
     * @description Временные данные, используются в this.encoder
     * @readonly
     * @private
     */
    private readonly db = {
        buffer: null    as Buffer,
        bitstream: null as number,
        remainder: null as Buffer
    };

    /**
     * @description Декодирование фрагмента в opus
     * @readonly
     * @private
     */
    private readonly packet = async (chunk: Buffer): Promise<Buffer | false> => {
        // Если размер буфера не является нужным, то пропускаем
        if (chunk.length < 26) return false;

        // Если не находим OGGs_HEAD в буфере
        else if (!chunk.subarray(0, 4).equals(OGG.OGGs_HEAD)) {
            this.emit("error", Error(`capture_pattern is not ${OGG.OGGs_HEAD}`));
            return false;
        }

        // Если находим stream_structure_version в буфере, но не той версии
        else if (chunk.readUInt8(4) !== 0) {
            this.emit("error", Error(`stream_structure_version is not 0`));
            return false;
        }

        const pageSegments = chunk.readUInt8(26);

        // Если размер буфера не подходит, то пропускаем
        if (chunk.length < 27 || chunk.length < 27 + pageSegments) return false;

        const table = chunk.subarray(27, 27 + pageSegments), sizes: number[] = [];
        let totalSize = 0;

        // Вычисляем размер opus буфера
        for (let i = 0; i < pageSegments;) {
            let size = 0, x = 255;

            while (x === 255) {
                if (i >= table.length) return false;
                x = table.readUInt8(i); i++; size += x;
            }

            sizes.push(size);
            totalSize += size;
        }

        // Если размер буфера не подходит, то пропускаем
        if (chunk.length < 27 + pageSegments + totalSize) return false;

        const bitstream = chunk.readUInt32BE(14);
        let start = 27 + pageSegments;

        // Ищем номер нужного буфера, он и есть opus
        for (const size of sizes) {
            const segment = chunk.subarray(start, start + size);
            const header = segment.subarray(0, 8);

            // Если уже есть буфер данных
            if (this.db.buffer) {
                if (header.equals(OGG.OPUS_TAGS)) this.emit("tags", segment);
                else if (this.db.bitstream === bitstream) this.push(segment);
            }

            // Если заголовок подходит под тип ogg/opus head
            else if (header.equals(OGG.OPUS_HEAD)) {
                this.emit("head", segment);
                this.db.buffer = segment;
                this.db.bitstream = bitstream;
            }

            // Если ничего из выше перечисленного не подходит
            else this.emit("unknownSegment", segment);
            start += size;
        }

        // Выдаем именно нужный буфер
        return chunk.subarray(start);
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform = async (chunk: Buffer, _: any, done: () => any) => {
        // Если есть прошлый буфер
        if (this.db.remainder) {
            chunk = Buffer.concat([this.db.remainder, chunk]);
            this.db.remainder = null;
        }

        // Получаем пакеты из
        while (!!chunk) {
            const packet = await this.packet(chunk);
            if (packet) chunk = packet;
            else break;
        }

        // Добавляем не прошедшие данные в буфер
        this.db.remainder = chunk;
        done();
    };

    /**
     * @description Уничтожаем расшифровщик
     * @param error - Если получена ошибка
     * @param callback - Если надо выполнить функцию
     */
    public _destroy(error: Error, callback: { (error?: Error): void }) {
        Logger.log("DEBUG", `[OpusEncoder] has destroyed`);

        super._destroy(error, callback);

        this.db.remainder = null;
        this.db.buffer = null;
        this.db.bitstream = null;
    };
}