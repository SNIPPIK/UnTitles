import {OpusEncoder, SILENT_FRAME} from "@service/voice";
import {Logger, TypedEmitter} from "@utils";
import {Process} from "./process";

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
    protected readonly _audioBuffer = new Array<Buffer>();

    /**
     * @description Кол-во пакетов в изначальном буфере
     * @protected
     */
    protected _bufferTotal = 0;

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable() {
        return this._audioBuffer.length > 0;
    };

    /**
     * @description Получаем время проигрывания потока
     * @public
     */
    public get duration() {
        if (!this._audioBuffer.length) return 0;

        return ((this._bufferTotal - this._audioBuffer.length) * 20) / 1e3;
    };

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        return this._audioBuffer.shift();
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
            path["once"](event, async () => {
                if (event === "error") this.emit("error", new Error("AudioResource get error for create stream"));
                options.events.destroy_callback(options.input);
            });
        }

        // Разовая функция для удаления потока
        this.once("close", async () => {
            options.events.destroy_callback(options.input);
        });

        // Если вводимый поток является расшифровщиком
        if (options.input instanceof Process) options.input.stdout.pipe(options.decoder);
        else options.input.on("frame", (packet: Buffer) => {
            // Сообщаем что поток можно начать читать
            if (this._audioBuffer.length === 0) {
                this.emit("readable");

                // Если поток включается в первый раз.
                // Добавляем пустышку для интерпретатора opus
                if (!this._bufferTotal) this._audioBuffer.push(SILENT_FRAME);
            }

            this._audioBuffer.push(packet);
            this._bufferTotal++;
        });
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param path - Путь до файла или ссылка
     * @param options - Настройки аудио класса
     * @public
     *
     * @example <path> or <url>
     */
    public constructor(path: string, options: {seek?: number; filters?: string;}) {
        super();
        if (options.seek > 0) this._bufferTotal = (options.seek * 1e3) / 20;

        const decoder = new OpusEncoder();

        // Расшифровщик
        this.input = {
            // Управление событиями
            events: {
                destroy: ["end", "close", "error"],
                destroy_callback: (input) => {
                    // Если поток еще существует
                    if (input) input.destroy();

                    // Добавляем пустышку для интерпретатора opus
                    this._audioBuffer.push(SILENT_FRAME);
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
                "-c:a", "libopus", "-f", "opus",
                "pipe:"
            ])
        };
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        Logger.log("DEBUG", `[AudioResource] has destroyed`);
        // Чистим все потоки от мусора
        this.emit("close");

        // Удаляем все вызовы функций
        this.removeAllListeners();
    };
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