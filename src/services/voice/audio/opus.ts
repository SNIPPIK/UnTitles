import { PassThrough } from "node:stream";
import { Logger } from "@utils";

const OGG_HEADER = Buffer.from("OggS");
const OPUS_HEAD = Buffer.from("OpusHead");
const OPUS_TAGS = Buffer.from("OpusTags");

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
     * @description Текущий буфер
     * @private
     */
    private buffer: Buffer | null = null;

    /**
     * @description Номер потока
     * @private
     */
    private bitstream: number | null = null;

    /**
     * @description Декодирование фрагмента в opus
     * @private
     */
    private extractPacket = (chunk: Buffer): Buffer | null => {
        // Минимальный размер ogg-страницы
        if (chunk.length < 27 || !chunk.subarray(0, 4).equals(OGG_HEADER)) {
            this.emit("error", new Error("OpusEncoder error: invalid OggS header"));
            return null;
        }

        const segments = chunk[26];
        const headerEnd = 27 + segments;

        // Если размер буфера не подходит, то пропускаем
        if (chunk.length < headerEnd) return null;

        const lacing = chunk.subarray(27, headerEnd);
        const sizes: number[] = [];
        let total = 0, i = 0;

        // Собираем размеры всех фреймов
        while (i < segments) {
            let size = 0, b: number;
            do {
                b = lacing[i++];
                size += b;
            } while (b === 255 && i < segments);
            sizes.push(size);
            total += size;
        }

        const pageEnd = headerEnd + total;
        if (chunk.length < pageEnd) return null;

        const bitstreamId = chunk.readUInt32LE(14);
        let offset = headerEnd;

        // Ищем номер нужного буфера, он и есть opus
        for (const size of sizes) {
            const seg = chunk.subarray(offset, offset + size);
            offset += size;

            if (!seg.length) continue;

            const tag = seg.subarray(0, 8);

            if (!this.buffer && tag.equals(OPUS_HEAD)) {
                this.buffer = seg;
                this.bitstream = bitstreamId;
                this.emit("head", seg);
                this.push(seg);
            }

            // Не push — это не аудиоданные
            else if (this.buffer && tag.equals(OPUS_TAGS)) this.emit("tags", seg);

            // Только если это аудиофрейм и совпадает поток
            else if (this.buffer && this.bitstream === bitstreamId) this.push(seg);

            // Только если это аудиофрейм и совпадает поток
            else this.emit("unknownSegment", seg);
        }

        // Возвращаем остаток, только если он точно начинается с нового OggS
        if (offset < chunk.length) {
            const next = chunk.subarray(offset, offset + 4);
            if (next.equals(OGG_HEADER)) return chunk.subarray(offset);
        }

        // Либо всё обработано, либо остаток сомнительный — отбрасываем
        return null;
    }

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform(chunk: Buffer, _enc: string, cb: (err?: Error) => void) {
        // Получаем пакеты из
        while (chunk) {
            const packet = this.extractPacket(chunk);
            if (packet) chunk = packet;
            else break;
        }
        cb();
    }

    /**
     * @description Уничтожаем расшифровщик
     * @param err - Если получена ошибка
     * @param cb - Если надо выполнить функцию
     */
    public _destroy(err: Error | null, cb: (e?: Error) => void) {
        Logger.log("DEBUG", `[OpusEncoder] destroyed`);
        this.buffer = null;
        this.bitstream = null;
        super._destroy(err, cb);
    }
}