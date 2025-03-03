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
    private readonly _streams: (Process | OpusEncoder)[] = [];

    /**
     * @description Параметры буфера потока
     * @readonly
     * @private
     */
    private readonly _buffer: AudioResourceBuffer = {
        chunks: [],
        total: 0
    };

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable() {
        return this._buffer.chunks.length > 0;
    };

    /**
     * @description Получаем время проигрывания потока
     * @public
     */
    public get duration() {
        if (!this._buffer.chunks.length) return 0;

        return ((this._buffer.total - this._buffer.chunks.length) * 20) / 1e3;
    };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        return this._buffer.chunks.shift();
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
        // Добавляем процесс в класс для отслеживания
        this._streams.push(options.input);

        // Запускаем все события
        for (const event of [...options.events.destroy, ...options.events.critical]) {
            // Если ивент относится к критичным
            if (options.events.critical.includes(event)) {
                if (options.events.path) (options.input)[options.events.path]["once"](event, options.events.critical_callback);
                else (options.input)["once"](event, () => options.events.critical_callback);
            }

            // Если ивент не относится к критичным
            else {
                if (options.events.path) (options.input)[options.events.path]["once"](event, options.events.destroy_callback);
                else (options.input)["once"](event, () => options.events.destroy_callback);
            }
        }

        // Если вводимый поток является расшифровщиком
        if (options.input instanceof Process) this.process.stdout.pipe(this.stream);
        else {
            this.stream.on("data", async (data) => {
                if (data) {
                    this._buffer.chunks.push(data);
                    this._buffer.total++;
                }
            });
        }
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param path - Путь до файла или ссылка
     * @param options - Настройки кодировщика
     * @public
     *
     * @example <path> or <url>
     */
    public constructor(path: string, options: {seek?: number; filters: string;}) {
        if (options.seek > 0) this._buffer.total = (options.seek * 1e3) / 20;

        // Расшифровщик
        this.input = {
            events: {
                destroy: ["end", "close"],
                destroy_callback: () => this.cleanup("opus"),

                critical: ["error"],
                critical_callback: () => this.cleanup(),
            },
            input: new OpusEncoder({
                readableObjectMode: true,
                autoDestroy: true
            })
        };

        // Процесс (FFmpeg)
        this.input = {
            events: {
                path: "stdout",

                destroy: ["end", "close"],
                destroy_callback: () => this.cleanup("ffmpeg"),

                critical: ["error"],
                critical_callback: () => this.cleanup()
            },
            input: new Process([ "-vn", "-loglevel", "panic",
                // Если это ссылка, то просим ffmpeg переподключиться при сбросе соединения
                ...(path.startsWith("http") ? ["-reconnect", "1", "-reconnect_at_eof", "1", "-reconnect_streamed", "1", "-reconnect_delay_max", "5"] : []),

                "-ss", `${options.seek ?? 0}`,

                // Файл или ссылка на ресурс
                "-i", path,

                // Подключаем фильтры
                ...(options.filters ? ["-af", options.filters] : []),

                // Указываем формат аудио
                "-f", "opus",
                "pipe:1"
            ])
        };
    };

    /**
     * @description Чистка от мусора
     * @param type - Тип потока для удаления именно нужного потока
     * @public
     */
    private cleanup = (type: "opus" | "ffmpeg" | "all" = "all") => {
        // Если надо удалить opusEncoder
        if (type === "opus") {
            this.stream.removeAllListeners();
            this.stream.destroy();
        }

        // Если надо удалить ffmpeg
        else if (type === "ffmpeg") this.process.destroy();

        // Если надо удалить все потоки!
        else {
            // Если streams уже удалены
            if (!this._streams) return;

            // Чистим все потоки от мусора
            for (const stream of this._streams) {

                // Если поток является OpusEncoder
                if (stream instanceof OpusEncoder) {
                    stream.removeAllListeners();
                }

                // Уничтожаем поток
                stream.destroy();
            }

            Logger.log("DEBUG", `[AudioResource] has cleanup`);
        }

        Logger.log("DEBUG", `[AudioResource/${type}] has cleanup`);
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        // Удаляем данные в следующем цикле
        setImmediate(() => {
            // Чистим все потоки от мусора
            this.cleanup();

            // Удаляем все параметры
            for (let key of Object.keys(this)) this[key] = null;
            Logger.log("DEBUG", `[AudioResource] has destroyed`);
        });
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для буфера потока
 * @interface AudioResourceBuffer
 */
interface AudioResourceBuffer {
    /**
     * @description Место для хранения пакетов потока
     * @protected
     */
    chunks: Buffer[];

    /**
     * @description Кол-во полученных пакетов
     * @protected
     */
    total: number;
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
    readonly input: OpusEncoder | Process;

    /**
     * @description Отслеживаемые события для удаления
     * @readonly
     */
    readonly events: {
        // Имена событий для удаления потока
        destroy: string[];

        // Функция для очистки потока
        destroy_callback: () => void;

        // Имена критичных событий для полного удаления потока
        critical: string[];

        // Функция для очистки потока
        critical_callback: () => void;

        /**
         * @description Если надо конкретно откуда-то отслеживать события
         * @readonly
         */
        path?: string
    };
}