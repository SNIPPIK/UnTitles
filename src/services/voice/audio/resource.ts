import {OpusEncoder} from "@service/voice";
import {Process} from "./process";
import {Logger} from "@utils";

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
            highWaterMark: 5 * 1024 * 1024,
            readableObjectMode: true,
            autoDestroy: true
        })
    ];

    /**
     * @description Данные для запуска процесса буферизации
     * @readonly
     * @private
     */
    private readonly chunks = {
        // Кол-во отправленных пакетов
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
        if (!this.chunks?.length || !this.chunks?.size) return 0;

        const duration = ((this.chunks.length * this.chunks.size) / 1e3).toFixed(0);
        return parseInt(duration);
    };

    /**
     * @description Получаем OpusEncoder
     * @return OpusEncoder
     * @public
     */
    public get stream() {
        if (!this._streams) return null;

        return this._streams.at(0) as OpusEncoder;
    };

    /**
     * @description Получаем Process
     * @return Process
     * @public
     */
    public get process() {
        if (!this._streams) return null;

        return this._streams.at(1) as Process;
    };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set input(options: AudioResourceInput) {
        // Подключаем события к потоку
        for (const event of options.events) {
            if (options.event) (options.input)[options.event]["once"](event, this.destroy);
            else (options.input)["once"](event, this.destroy);
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

        // Процесс (FFmpeg)
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
                "-f", "opus",
                "pipe:1"
            ])
        };

        // Расшифровщик
        this.input = {
            input: this.stream,
            events: ["end", "close", "error"]
        };
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        // Удаляем данные в следующем цикле
        setImmediate(() => {
            // Чистим все потоки от мусора
            for (const stream of this._streams) {

                // Если поток является OpusEncoder
                if (stream instanceof OpusEncoder) {
                    stream.removeAllListeners();
                    stream.destroy();

                    // Чистим поток от остатков пакетов
                    while (stream.read()) {}

                    stream.end();
                }

                else stream.destroy();
            }
            // Удаляем все параметры
            for (let key of Object.keys(this)) this[key] = null;
            Logger.log("DEBUG", `[AudioResource] has destroyed`);
        });
    };
}


/**
 * @author SNIPPIK
 * @description Параметры для функции совмещения потоков
 * @interface AudioResourceInput
 */
interface AudioResourceInput {
    /**
     * @description Входящий поток
     * @readonly
     */
    readonly input: NodeJS.ReadWriteStream | Process;

    /**
     * @description Отслеживаемые события для удаления
     * @readonly
     */
    readonly events: string[];

    /**
     * @description Если надо конкретно откуда-то отслеживать события
     * @readonly
     */
    readonly event?: string;
}