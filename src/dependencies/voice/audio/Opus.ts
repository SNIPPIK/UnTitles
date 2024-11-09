import {Transform, TransformOptions} from "node:stream";
import {Buffer} from "node:buffer";

/**
 * @author SNIPPIK
 * @description Доступные библиотеки для включения
 */
const OpusLibs = {
    "opusscript": (lib: any): Methods => {
        return { args: [48000, 2, 2049], encoder: lib }
    },
    "mediaplex": (lib: any): Methods => {
        return { args: [48000, 2], encoder: lib.OpusEncoder }
    },
    "@evan/opus": (lib: any): Methods => {
        return { args: [{ channels: 2, sample_rate: 48000 }], encoder: lib.Encoder }
    },
    "@discordjs/opus": (lib: any): Methods => {
        return { args: [48000, 2], encoder: lib.OpusEncoder }
    },
}, Opus: Methods = {};

/**
 * @author SNIPPIK
 * @description Превращаем имя переменной в буфер
 * @param name - Имя переменной
 */
const bufferCode = (name: string) => {
    return Buffer.from([...`${name}`].map((x: string) => x.charCodeAt(0)))
};

/**
 * @author SNIPPIK
 * @description Доступный формат для отправки opus пакетов
 */
const bit = 960 * 2 * 2;

/**
 * @author SNIPPIK
 * @description Заголовки для поиска в chuck
 */
const OGG = {
    "OGGs_HEAD": bufferCode("OggS"),
    "OPUS_HEAD": bufferCode("OpusHead"),
    "OPUS_TAGS": bufferCode("OpusTags")
};

/**
 * @author SNIPPIK
 * @description Проверяем на наличие библиотек, если будет найдена библиотека то она будет использоваться
 */
(() => {
    // Проверяем на наличие библиотек
    for (const name of Object.keys(OpusLibs)) {
        try {
            const library = require(name);

            // Добавляем библиотеку если она конечно есть
            Object.assign(Opus, {...OpusLibs[name](library), name});
            delete require.cache[require.resolve(name)];
            return;
        } catch {}
    }
})();

/**
 * @author SNIPPIK
 * @description Создаем кодировщик в opus
 * @class OpusEncoder
 * @extends Transform
 */
export class OpusEncoder extends Transform {
    private readonly encoder: any = null;
    private readonly _temp = {
        remaining: null as Buffer,
        buffer: null    as Buffer,
        bitstream: null as number,

        argument: true  as boolean,
        index: 0
    };
    /**
     * @description Название библиотеки и тип аудио для ffmpeg
     * @return {name: string, ffmpeg: string}
     * @public
     */
    public static get lib(): {name: string, ffmpeg: string} {
        if (Opus?.name) return { name: Opus.name, ffmpeg: "s16le" };
        return { name: "Native/Opus", ffmpeg: "opus" };
    };

    /**
     * @description Проверяем возможно ли начать читать поток
     * @private
     */
    private get argument() {
        if (this.encoder) return this._temp.buffer.length >= bit * (this._temp.index + 1);
        return this._temp.argument;
    };

    /**
     * @description Запуск класса расшифровки в opus
     * @param options
     * @public
     */
    public constructor(options: TransformOptions = {autoDestroy: true, objectMode: true}) {
        super(Object.assign({ readableObjectMode: true }, options));

        //Если была найдена opus library
        if (Opus?.name) {
            //Подключаем opus library
            this.encoder = new Opus.encoder(...Opus.args);
            this._temp.buffer = Buffer.alloc(0);
        }
    };

    /**
     * @description Декодирование фрагмента в opus
     * @private
     */
    private packet = (chunk: Buffer) => {
        // Если есть подключенный кодировщик, то используем его
        if (this.encoder) return this.encoder.encode(chunk, 960);

        // Если размер буфера не является нужным, то пропускаем
        else if (chunk.length < 26) return false;

        // Если не находим OGGs_HEAD в буфере
        else if (!chunk.subarray(0, 4).equals(OGG.OGGs_HEAD)) {
            this.emit("error", Error(`capture_pattern is not ${OGG.OGGs_HEAD}`));
            return false;
        }

        // Если находим stream_structure_version в буфере, но не той версии
        else if (chunk.readUInt8(4) !== 0) {
            this.emit("error", Error(`stream_structure_version is not ${0}`));
            return false;
        }

        const pageSegments = chunk.readUInt8(26);

        // Если размер буфера не подходит, то пропускаем
        if (chunk.length < 27 || chunk.length < 27 + pageSegments) return false;

        const table = chunk.subarray(27, 27 + pageSegments), sizes: number[] = [];
        let totalSize = 0;

        // Ищем номера opus буфера
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

        //Ищем нужный пакет, тот самый пакет opus
        for (const size of sizes) {
            const segment = chunk.subarray(start, start + size);
            const header = segment.subarray(0, 8);

            // Если уже есть буфер данных
            if (this._temp.buffer) {
                if (header.equals(OGG.OPUS_TAGS)) this.emit("tags", segment);
                else if (this._temp.bitstream === bitstream) this.push(segment);
            }

            // Если заголовок подходит под тип ogg/opus head
            else if (header.equals(OGG.OPUS_HEAD)) {
                this.emit("head", segment);
                this._temp.buffer = segment;
                this._temp.bitstream = bitstream;
            }

            // Если ничего из выше перечисленного не подходит
            else this.emit("unknownSegment", segment);
            start += size;
        }

        //Выдаем следующие данные
        return chunk.subarray(start);
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform = (chunk: Buffer, _: any, done: () => any) => {
        let index = this._temp.index, packet = () => chunk;

        // Если есть подключенная библиотека расшифровки opus, то используем ее
        if (this.encoder) {
            this._temp.buffer = Buffer.concat([this._temp.buffer, chunk]);
            packet = () => this._temp.buffer.subarray(index * bit, (index + 1) * bit);
        } else setImmediate(() => this._temp.remaining = chunk);

        // Если есть прошлый фрагмент расшифровки
        if (this._temp.remaining) {
            chunk = Buffer.concat([this._temp.remaining, chunk]);
            this._temp.remaining = null;
        }

        // Начинаем чтение пакетов
        while (this.argument) {
            const encode = this.packet(packet());

            if (this.encoder) this.push(encode);
            else {
                if (encode) chunk = encode;
                else break;
            }

            index++;
        }

        // Если номер пакета больше 1, то добавляем прошлый пакет в базу
        if (index > 0) this._temp.buffer = this._temp.buffer.subarray(index * bit);

        return done();
    };

    /**
     * @description Удаляем данные по окончанию
     * @public
     */
    public _final = (cb: () => void) => {
        this.destroy();
        cb();
    };

    /**
     * @description Удаляем данные по завершению
     * @public
     */
    public _destroy = () => {
        if (typeof this.encoder?.delete === "function") this.encoder!.delete!();
        for (let name of Object.keys(this._temp)) this._temp[name] = null;

        //@ts-expect-error
        this["encoder"] = null;
    };
}

/**
 * @description Выдаваемы методы для работы opus encoder
 */
interface Methods {
    //Имя библиотеки
    name?: string;

    //Аргументы для запуска
    args?: any[];

    //Класс для расшифровки
    encoder?: any;
}