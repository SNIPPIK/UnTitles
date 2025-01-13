import {ChildProcessWithoutNullStreams, spawn, spawnSync} from "node:child_process";
import {Transform, TransformOptions} from "node:stream";
import {Buffer} from "node:buffer";
import path from "node:path";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Доступные библиотеки для включения
 * @private
 */
const support_libs: Methods.supported = {
    "opusscript": (lib) => ({ args: [48000, 2, 2049], encoder: lib }),
    "mediaplex": (lib) => ({ args: [48000, 2], encoder: lib.OpusEncoder }),
    "@evan/opus": (lib) => ({ args: [{ channels: 2, sample_rate: 48000 }], encoder: lib.Encoder })
};

/**
 * @author SNIPPIK
 * @description Здесь будет находиться найденная библиотека, если она конечно будет найдена
 * @private
 */
const loaded_lib: Methods.current = {};

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
 * @description Доступный формат для отправки opus пакетов
 * @private
 */
const bit = 960 * 2 * 2;

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
 * @description Конвертирует аудио в нужный формат
 * @class AudioResource
 * @public
 */
export class AudioResource {
    /**
     * @description Временное хранилище для потоков
     * @readonly
     * @private
     */
    private readonly _streams: (Process | OpusEncoder)[] = [
        new OpusEncoder({
            highWaterMark: 5 * 1000 * 1000,
            readableObjectMode: true
        })
    ];

    /**
     * @description Данные для запуска процесса буферизации
     * @readonly
     * @private
     */
    private readonly chunks = {
        // Кол-во пакетов
        length:    0,

        // Размер пакета
        size:     20
    };

    /**
     * @description Можно ли читать поток
     * @private
     */
    private _readable = false;

    /**
     * @description Можно ли читать поток
     * @default true - Всегда можно читать поток, если поток еще не был загружен то отправляем пустышки
     * @return boolean
     * @public
     */
    public get readable() { return this._readable; };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        const packet = this.stream.read();

        // Если есть аудио пакеты
        if (packet) this.chunks.length++;

        // Отправляем пакет
        return packet;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @public
     */
    public get duration() {
        const duration = ((this.chunks.length * this.chunks.size) / 1e3).toFixed(0);
        return parseInt(duration);
    };

    /**
     * @description Получаем OpusEncoder
     * @return OpusEncoder
     * @public
     */
    public get stream() { return this._streams.at(0) as OpusEncoder; };

    /**
     * @description Получаем Process
     * @return Process
     * @public
     */
    public get process() { return this._streams.at(1) as Process; };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set input(options: {input: NodeJS.ReadWriteStream | Process, event?: string, events: string[]}) {
        // Подключаем события к потоку
        for (const event of options.events) {
            if (options.event) options.input[options.event].once(event, this.destroy);
            else options.input["once"](event, this.destroy);
        }

        // Добавляем процесс в класс для отслеживания
        if (options.input instanceof Process) this._streams.push(options.input);
        else {
            options.input.once("readable", () => { this._readable = true; });
            this.process.stdout.pipe(options.input);
        }
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param options - Настройки кодировщика
     * @public
     */
    public constructor(options: {path: string, seek?: number; filters: string; chunk?: number}) {
        if (options.chunk > 0) this.chunks.size = 20 * options.chunk;
        if (options.seek > 0) this.chunks.length = (options.seek * 1e3) / this.chunks.size;

        // Процесс
        this.input = {
            events: ["error"],
            event: "stdout",
            input: new Process([ "-vn",  "-loglevel", "panic",
                // Если это ссылка, то просим ffmpeg переподключиться при сбросе соединения
                ...(options.path.startsWith("http") ? ["-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),
                "-ss", `${options.seek ?? 0}`, "-i", options.path,

                // Подключаем фильтры
                ...(options.filters ? ["-af", options.filters] : []),

                // Указываем формат аудио
                "-f", `${OpusEncoder.lib.ffmpeg}`,
                "pipe:1"
            ])
        };

        // Расшифровщик
        this.input = {
            input: this.stream,
            events: ["end", "close", "error", "drain"]
        };
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        // Удаляем поток после всех действий, даже если он будет включен заново он все равно будет удален
        setImmediate(() => {
            for (const stream of this._streams) {
                if (stream instanceof Process) stream.destroy();
                else {
                    stream.emit("close");
                    stream?.destroy();
                    stream?.end();
                }
            }

            this._streams.splice(0, this._streams.length);
        });

        Object.keys(this.chunks).forEach(key => this.chunks[key] = null);
        this._readable = null;
    };
}


/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg/avconv
 */
(() => {
    const cache = env.get("cache.dir");
    const names = [`${cache}/FFmpeg/ffmpeg`, cache, env.get("ffmpeg.path")].map((file) => path.resolve(file).replace(/\\/g,'/'));

    // Проверяем имена, если есть FFmpeg/avconv
    for (const name of [...names, "ffmpeg", "avconv"]) {
        try {
            const result = spawnSync(name, ['-h'], {windowsHide: true});
            if (result.error) continue;
            return env.set("ffmpeg.path", name);
        } catch {}
    }

    // Выдаем ошибку если нет FFmpeg/avconv
    throw Error("[Critical]: FFmpeg/avconv not found!");
})();

/**
 * @author SNIPPIK
 * @description Для уничтожения использовать <class>.emit("close")
 * @class Process
 * @private
 */
export class Process {
    /**
     * @description Процесс запущенный через spawn
     * @private
     */
    private _process: ChildProcessWithoutNullStreams = null;

    /**
     * @description Получаем ChildProcessWithoutNullStreams
     * @return ChildProcessWithoutNullStreams
     * @public
     */
    public get process() { return this._process; }

    /**
     * @description Зарезервирован для вывода данных, как правило (хотя и не обязательно)
     * @return internal.Readable
     * @public
     */
    public get stdout() { return this?.process?.stdout; };

    /**
     * @description Задаем параметры и запускаем процесс
     * @param args {string[]} Аргументы для запуска
     * @param name {string} Имя процесса
     */
    public constructor(args: string[], name: string = env.get("ffmpeg.path")) {
        this._process = spawn(name, args, {shell: false});
        ["end", "close", "error", "disconnect", "exit"].forEach((event) => this.process.once(event, this.destroy));
    };

    /**
     * @description Удаляем и отключаемся от процесса
     * @private
     */
    public destroy = () => {
        if (this._process && !this.process?.killed) this.process?.kill();
        this._process = null;
    };
}


/**
 * @author SNIPPIK
 * @description Проверяем на наличие библиотек, если будет найдена библиотека то она будет использоваться
 * @async
 */
(async () => {
    const names = Object.keys(support_libs);

    for (const name of names) {
        try {
            const library = require(name);
            if (library?.ready) await library.ready;
            Object.assign(loaded_lib, support_libs[name](library));
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
 * @public
 */
class OpusEncoder extends Transform {
    /**
     * @description Расшифровщик если он найдет
     * @readonly
     * @private
     */
    private readonly encoder: any = null;

    /**
     * @description Временные данные, используются в this.encoder
     * @readonly
     * @private
     */
    private readonly db = {
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
     * @static
     */
    public static get lib(): {name: string, ffmpeg: string} {
        if (loaded_lib?.name) return { name: loaded_lib.name, ffmpeg: "s16le" };
        return { name: "Native/Opus", ffmpeg: "opus" };
    };

    /**
     * @description Проверяем возможно ли начать читать поток
     * @private
     */
    private get argument() {
        if (this.encoder) return this.db.buffer.length >= bit * (this.db.index + 1);
        return this.db.argument;
    };

    /**
     * @description Запуск класса расшифровки в opus
     * @param options
     * @constructor
     * @public
     */
    public constructor(options: TransformOptions = {autoDestroy: true, objectMode: true}) {
        super(Object.assign({ readableObjectMode: true }, options));

        //Если была найдена opus library
        if (loaded_lib?.name) {
            //Подключаем opus library
            this.encoder = new loaded_lib.encoder(...loaded_lib.args);
            this.db.buffer = Buffer.alloc(0);
        }
    };

    /**
     * @description Декодирование фрагмента в opus
     * @readonly
     * @private
     */
    private readonly packet = (chunk: Buffer) => {
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

        //Выдаем следующие данные
        return chunk.subarray(start);
    };

    /**
     * @description При получении данных через pipe или write, модифицируем их для одобрения со стороны discord
     * @public
     */
    public _transform = (chunk: Buffer, _: any, done: () => any) => {
        let index = this.db.index, packet = () => chunk;

        // Если есть подключенная библиотека расшифровки opus, то используем ее
        if (this.encoder) {
            this.db.buffer = Buffer.concat([this.db.buffer, chunk]);
            packet = () => this.db.buffer.subarray(index * bit, (index + 1) * bit);
        } else setImmediate(() => this.db.remaining = chunk);

        // Если есть прошлый фрагмент расшифровки
        if (this.db.remaining) {
            chunk = Buffer.concat([this.db.remaining, chunk]);
            this.db.remaining = null;
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
        if (index > 0) this.db.buffer = this.db.buffer.subarray(index * bit);

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
        for (let key of Object.keys(this.db)) this.db[key] = null;

        //@ts-expect-error
        this["encoder"] = null;
    };
}


/**
 * @author SNIPPIK
 * @description Типы для правильной работы typescript
 */
namespace Methods {
    /**
     * @author SNIPPIK
     * @description Поддерживаемый запрос к библиотеке
     * @type supported
     */
    export type supported = {
        [name: string]: (lib: any) => current
    }

    /**
     * @author SNIPPIK
     * @description Выдаваемы методы для работы opus encoder
     */
    export interface current {
        //Имя библиотеки
        name?: string;

        //Аргументы для запуска
        args?: any[];

        //Класс для расшифровки
        encoder?: any;
    }
}