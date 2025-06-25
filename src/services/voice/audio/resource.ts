import { PipeEncoder, BufferedEncoder, SILENT_FRAME, OPUS_FRAME_SIZE } from "./opus";
import { TypedEmitter } from "#structures";
import { Logger } from "#structures/logger";
import { Process } from "./process";

/**
 * @author SNIPPIK
 * @description Класс для хранения аудио фреймов потока, для повторного использования
 * @usage Использовать только для треков не более 8 мин
 * @class AudioBuffer
 * @private
 */
class AudioBuffer {
    /**
     * @description Хранилище аудио фреймов
     * @readonly
     * @public
     */
    protected readonly _chunks: Buffer[] = new Array<Buffer>();

    /**
     * @description Текущая позиция в системе фреймов
     * @private
     */
    private _position = 0;

    /**
     * @description Кол-во пакетов в буфере
     * @public
     */
    public get size() {
        return this._chunks.length;
    };

    /**
     * @description Текущая позиция в буферной системе
     * @public
     */
    public get position() {
        return this._position;
    };

    /**
     * @description Текущая позиция в буферной системе
     * @public
     */
    public set position(position) {
        if (position > this.size || position < 0) return;
        this._position = position;
    };

    /**
     * @description Сохранение фрагмента
     * @public
     */
    public set packet(chunk) {
        this._chunks.push(chunk);
    };

    /**
     * @description Выдача пакета, через текущую позицию
     * @public
     */
    public get packet() {
        if (this.position >= this.size) return null;
        const frame = this._chunks[this._position++];
        return frame ?? SILENT_FRAME;
    };

    /**
     * @description Удаляем данные буфера
     * @public
     */
    public clear = () => {
        // Удаляем ссылки на буферы
        this._chunks.length = 0;
        this._position = null;
    };
}

/**
 * @author SNIPPIK
 * @description Базовый класс для создания аудио
 * @class BaseAudioResource
 * @extends TypedEmitter<AudioResourceEvents>
 * @abstract
 */
abstract class BaseAudioResource extends TypedEmitter<AudioResourceEvents> {
    /**
     * @description Можно ли читать поток
     * @protected
     */
    protected _readable = false;

    /**
     * @description Параметр seek, для вычисления времени проигрывания
     * @protected
     */
    protected _seek = 0;

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable(): boolean {
        return this._readable;
    };

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public get duration() {
        return 0;
    };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        return SILENT_FRAME;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        return 0;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @protected
     */
    protected constructor({options}: AudioResourceOptions) {
        super();

        if (options?.seek > 0) this._seek = (options.seek * 1e3) / OPUS_FRAME_SIZE;
    };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @protected
     */
    protected input<T>(options: AudioResourceInput<T>) {
        // Запускаем все события
        for (const event of options.events.destroy) {
            const path = options.events.path ? options.input[options.events.path] : options.input;

            // Запускаем прослушивание события
            path["once"](event, (err: any) => {
                if (event === "error") this.emit("error", new Error(`AudioResource get ${err}`));
                options.events.destroy_callback(options.input);
            });
        }

        // Разовая функция для удаления потока
        this.once("close", options.events.destroy_callback.bind(this, options.input));

        return options.decode(options.input);
    };

    /**
     * @description Удаляем ненужные данные
     * @protected
     */
    protected _destroy = () => {
        Logger.log("DEBUG", `[AudioResource] has destroyed`);

        // Чистим все потоки от мусора
        this.emit("close");

        // Удаляем все вызовы функций
        this.removeAllListeners();

        this._readable = null;
        this._seek = null;
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует ссылку или путь до файла в чистый opus для работы с discord
 * @usage Только для треков, до 8 мин!
 * @class BufferedAudioResource
 * @extends BaseAudioResource
 * @public
 */
export class BufferedAudioResource extends BaseAudioResource {
    /**
     * @description Список аудио буферов, для временного хранения
     * @protected
     * @readonly
     */
    private readonly _buffer = new AudioBuffer();

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable() {
        return this._buffer.position !== this._buffer.size;
    };

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public get duration() {
        if (!this._buffer.position) return 0;
        return Math.abs((((this._buffer.position + this._seek) * OPUS_FRAME_SIZE) / 1e3));
    };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        return this._buffer.packet;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        return this._buffer.size - this._buffer.position;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @public
     *
     * @example <path> or <url>
     */
    public constructor(public config: AudioResourceOptions) {
        super(config);

        const {path, options} = config;
        const decoder = new BufferedEncoder({
            highWaterMark: 512 * 5
        });

        // Расшифровщик
        this.input<BufferedEncoder>({
            // Создание потока
            input: decoder,

            // Управление событиями
            events: {
                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) input.destroy();
                    this.emit("end");
                }
            },

            // Начало кодирования
            decode: (input) => {
                // Если поток нельзя читать, возможно что он еще грузится
                const timeout = setTimeout(() => {
                    // Отправляем данные событию для отображения ошибки
                    this.emit("error", new Error("Timeout: the stream has been exceeded!"));
                    // Начинаем уничтожение потока
                    this.emit("close");
                }, 15e3);

                input.on("frame", (packet: Buffer) => {
                    // Сообщаем что поток можно начать читать
                    if (this._buffer.size === 0) {
                        clearTimeout(timeout);
                        this.emit("readable");
                    }

                    this._buffer.packet = packet;
                });
            }
        });

        // Процесс (FFmpeg)
        this.input<Process>({
            // Создание потока
            input: new Process([
                // Пропуск времени
                "-ss", `${options.seek ?? 0}`,

                // Файл или ссылка на ресурс
                "-i", path,

                // Подключаем фильтры
                "-af", options.filters,

                // Указываем формат аудио (ogg/opus)
                "-acodec", "libopus",
                "-frame_duration", "20",
                "-compression_level", "10",
                "-f", "opus",

                "pipe:"
            ]),

            // Управление событиями
            events: {
                path: "stdout",

                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) input.destroy();

                    this.emit("end");
                },
            },

            // Начало кодирования
            decode: (input: Process) => {
                input.stdout.pipe(decoder);
            },
        });
    };

    /**
     * @description Обновление потока, без потерь
     * @public
     */
    public refresh = () => {
        this._seek = 0;
        this._buffer.position = 0;
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        this._buffer.clear();
        this._destroy();
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует ссылку или путь до файла в чистый opus для работы с discord
 * @usage Можно использовать любой тип аудио, хоть 20 часов
 * @class PipeAudioResource
 * @extends BaseAudioResource
 * @public
 */
export class PipeAudioResource extends BaseAudioResource {
    /**
     * @description Реал тайм декодер opus фрагментов
     * @private
     */
    private encoder = new PipeEncoder({
        highWaterMark: 512 * 5
    });

    /**
     * @description Кол-во проигранных пакетов
     * @private
     */
    private played = 0;

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        const packet = this.encoder.read();

        // Если есть аудио пакеты
        if (packet) this.played++;

        // Отправляем пакет
        return packet;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        return this.encoder.writableLength / OPUS_FRAME_SIZE;
    };

    /**
     * @description Получаем время, время зависит от прослушанных пакетов
     * @public
     */
    public get duration() {
        return (this._seek + this.played * OPUS_FRAME_SIZE) / 1e3;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param config - Настройки кодировщика
     * @public
     */
    public constructor(config: AudioResourceOptions) {
        super(config);
        const {path, options} = config;

        // Расшифровщик
        this.input<PipeEncoder>({
            // Создание потока
            input: this.encoder,

            // Управление событиями
            events: {
                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) input.destroy();
                    this.emit("end");
                }
            },

            // Начало кодирования
            decode: (input) => {
                // Если поток нельзя читать, возможно что он еще грузится
                const timeout = setTimeout(() => {
                    // Отправляем данные событию для отображения ошибки
                    this.emit("error", new Error("Timeout: the stream has been exceeded!"));
                    // Начинаем уничтожение потока
                    this.emit("close");
                }, 15e3);

                input.once("readable", () => {
                    clearTimeout(timeout);
                    this._readable = true;
                    this.emit("readable");
                });
            }
        });

        // Процесс (FFmpeg)
        this.input<Process>({
            // Создание потока
            input: new Process([
                // Пропуск времени
                "-ss", `${options.seek ?? 0}`,

                // Файл или ссылка на ресурс
                "-i", path,

                // Подключаем фильтры
                "-af", options.filters,

                // Указываем формат аудио (ogg/opus)
                "-acodec", "libopus",
                "-frame_duration", "20",
                "-compression_level", "10",
                "-f", "opus",

                "pipe:"
            ]),

            // Управление событиями
            events: {
                path: "stdout",
                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) input.destroy();
                    this.emit("end");
                },
            },

            // Начало кодирования
            decode: (input) => {
                input.stdout.pipe(this.encoder);
            },
        });
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        this.played = null;
        this.encoder = null;

        this._destroy();
    };
}




/**
 * @author SNIPPIK
 * @description Параметры для создания класса AudioResource
 * @interface AudioResourceOptions
 */
interface AudioResourceOptions {
    path: string;
    options: {
        seek?: number;
        filters?: string;
    }
}

/**
 * @author SNIPPIK
 * @description События аудио потока
 * @interface AudioResourceEvents
 */
interface AudioResourceEvents {
    /**
     * @description События при котором можно начинать чтение потока
     * @readonly
     */
    readonly "readable": () => void;

    /**
     * @description Событие при котором поток удален
     * @readonly
     */
    readonly "end": () => void;

    /**
     * @description Событие при котором поток начнет уничтожатся
     * @readonly
     */
    readonly "close": () => void;

    /**
     * @description Событие при котором поток получил ошибку
     * @readonly
     */
    readonly "error": (error: Error) => void;
}

/**
 * @author SNIPPIK
 * @description Параметры для функции совмещения потоков
 * @interface AudioResourceInput
 */
interface AudioResourceInput<T> {
    /**
     * @description Входящий поток
     * @readonly
     */
    readonly input: T;

    /**
     * @description Отслеживаемые события для удаления
     * @readonly
     */
    readonly events: {
        // Имена событий для удаления потока
        destroy: string[];

        // Функция для очистки потока
        destroy_callback: (input: T) => void;

        /**
         * @description Если надо конкретно откуда-то отслеживать события
         * @readonly
         */
        path?: string
    };

    /**
     * @description Как начать передавать данные из потока
     * @readonly
     */
    readonly decode: (input: T) => void;
}