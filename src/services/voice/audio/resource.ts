import {OpusEncoder, SILENT_FRAME} from "./opus";
import {Logger, TypedEmitter} from "@utils";
import {Process} from "./process";

/**
 * @author SNIPPIK
 * @description Класс для хранения аудио фреймов потока, для повторного использования
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
        return frame ?? null;
    };

    /**
     * @description Удаляем данные буфера
     * @public
     */
    public clear = () => {
        // Удаляем ссылки на буферы
        this._chunks.length = 0;
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует ссылку или путь до файла в чистый opus для работы с discord
 * @class AudioResource
 * @public
 */
export class AudioResource extends TypedEmitter<AudioResourceEvents> {
    /**
     * @description Список аудио буферов, для временного хранения
     * @protected
     * @readonly
     */
    private readonly _buffer = new AudioBuffer();

    /**
     * @description Параметр seek, для вычисления времени проигрывания
     * @protected
     */
    protected _seek = 0;

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
        return Math.abs(((this._seek - this._buffer.position) * 20) / 1e3);
    };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        return this._buffer.packet;
    };

    /**
     * @description Подключаем поток к ffmpeg
     * @param options - Параметры для запуска
     * @private
     */
    private set input(options: AudioResourceInput) {
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
        this.once("close", () => {
            options.events.destroy_callback(options.input);
        });

        // Если вводимый поток является расшифровщиком
        if (options.input instanceof Process) options.input.stdout.pipe(options.decoder);
        else {
            // Если поток нельзя читать, возможно что он еще грузится
            const timeout = setTimeout(() => {
                // Отправляем данные событию для отображения ошибки
                this.emit("error", new Error("Timeout: the stream has been exceeded!"));
                // Начинаем уничтожение потока
                this.emit("close");
            }, 15e3);

            options.input.on("frame", (packet: Buffer) => {
                // Сообщаем что поток можно начать читать
                if (this._buffer.size === 0) {
                    clearTimeout(timeout);
                    this.emit("readable");

                    // Если поток включается в первый раз.
                    // Добавляем пустышку для интерпретатора opus
                    if (!this._seek) this._buffer.packet = SILENT_FRAME;
                }

                this._buffer.packet = packet;
            });
        }
    };

    /**
     * @description Создаем класс и задаем параметры
     * @public
     *
     * @example <path> or <url>
     */
    public constructor(public config: AudioResourceOptions) {
        super();
        const {path, options} = config;
        if (options?.seek > 0) this._seek = (options.seek * 1e3) / 20;

        const decoder = new OpusEncoder();

        // Расшифровщик
        this.input = {
            // Управление событиями
            events: {
                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) {
                        input.destroy();

                        // Добавляем пустышку для интерпретатора opus
                        this._buffer.packet = SILENT_FRAME;
                    }

                    this.emit("end");
                }
            },
            // Создание потока
            input: decoder
        };

        // Процесс (FFmpeg)
        this.input = {
            decoder,
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
            // Создание потока
            input: new Process([
                // Пропуск времени
                "-ss", `${options.seek ?? 0}`,

                // Файл или ссылка на ресурс
                "-i", path,

                // Подключаем фильтры
                "-af", options.filters,

                // Указываем формат аудио (ogg/opus)
                "-c:a", "libopus",
                "-f", "opus",
                "-application", "audio",

                "-ar", "48000",
                "-ac", "2",

                "pipe:"
            ])
        };
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
        Logger.log("DEBUG", `[AudioResource] has destroyed`);
        // Чистим все потоки от мусора
        this.emit("close");

        this._buffer.clear();

        // Удаляем все вызовы функций
        this.removeAllListeners();
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
interface AudioResourceInput {
    /**
     * @description Входящий поток
     * @readonly
     */
    readonly input: OpusEncoder | Process;

    /**
     * @description Расшифровывающий поток из ogg в opus
     * @readonly
     */
    readonly decoder?: OpusEncoder;

    /**
     * @description Отслеживаемые события для удаления
     * @readonly
     */
    readonly events: {
        // Имена событий для удаления потока
        destroy: string[];

        // Функция для очистки потока
        destroy_callback: (input: OpusEncoder | Process) => void;

        /**
         * @description Если надо конкретно откуда-то отслеживать события
         * @readonly
         */
        path?: string
    };
}