import { BufferedEncoder, OPUS_FRAME_SIZE, PipeEncoder } from "./opus";
import { Logger } from "#structures/logger";
import { TypedEmitter } from "#structures";
import { Process } from "./process";
import { db } from "#app/db";

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
    protected _chunks: Buffer[] = new Array<Buffer>();

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
        this._position = Math.max(0, Math.min(position, this.size));
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
        if (this._position >= this.size) return null;
        return this._chunks[this._position++];
    };

    /**
     * @description Удаляем данные буфера
     * @public
     */
    public clear = () => {
        this._chunks = [];
        this._chunks.length = 0;
        this._chunks = null;
        this._position = null;
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
    protected _readable: boolean;

    /**
     * @description Последнее заданное значение затухания
     * @protected
     */
    protected _afade = 0;

    /**
     * @description Если чтение возможно
     * @public
     */
    public abstract get readable(): boolean;

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public abstract get duration(): number;

    /**
     * @description Выдаем фрагмент потока или пустышку
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public abstract get packet(): Buffer;

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public abstract get packets(): number;

    /**
     * @description Создание аргументов для FFmpeg
     * @private
     */
    protected get arguments(): string[] {
        const { seek, inputs, old_seek } = this.options;
        const args = [];

        // Подготавливаем несколько потоков
        inputs.forEach((url, index) => {
            // Добавляем пропуск по времени
            args.push("-accurate_seek");

            // Только для первого потока
            if (index === 0 && inputs.length > 1) {
                // Добавляем пропуск по времени
                args.push("-ss", `${old_seek ? old_seek : seek}`);

                // Увеличиваем разбег для плавности
                args.push("-t", this._afade);
            }

            // Если другой поток
            else {
                // Добавляем пропуск по времени
                args.push("-ss", `${seek}`);
            }

            // Добавляем ссылку
            args.push("-i", url);
        });

        return [
            // Добавляем -nostdin, чтобы предотвратить блокировку FFmpeg
            "-nostdin",

            ...args,
            ...this.filters,

            // Указываем формат аудио (ogg/opus)
            "-acodec", "libopus",
            "-frame_duration", "20",
            "-application", "lowdelay",
            "-f", "opus",
            "pipe:1"
        ];
    };

    /**
     * @description Собираем фильтры для ffmpeg
     * @protected
     */
    protected get filters(): string[] {
        const { inputs, volume, filters, old_filters, crossfade } = this.options;
        const afade = [];
        const args_filters = [
            `volume=${volume / 150}`
        ];

        // Если есть используемые фильтры
        if (filters) args_filters.unshift(filters);

        switch (inputs.length) {
            // Если поток 1
            case 1: {
                // Если можно использовать приглушение
                if (crossfade.duration) {
                    afade.push(
                        `[0:a]afade=t=in:st=0:d=${this._afade}[a1]`,
                        `[a1]afade=t=out:st=${crossfade.duration - this._afade}:d=${this._afade}[a2]`,
                        `[a2]${args_filters.join(",")}[final_audio]`,
                    );
                }

                // Если можно использовать приглушение, но только в начале
                else {
                    afade.push(
                        `[0:a]afade=t=in:st=0:d=${this._afade}[a1]`,
                        `[a1]${args_filters.join(",")}[final_audio]`,
                    );
                }
                break;
            }

            // Если потоков несколько
            case 2: {
                // Если есть фильтры прошлого аудио потока
                if (old_filters) {
                    afade.push(
                        `[0:a]afade=t=in:st=0:d=${this._afade}[a0f]`,
                        `[a0f]${old_filters}[a0]`,
                        `[1:a]${args_filters.join(",")}[a1]`,
                        `[a0][a1]acrossfade=d=${this._afade}:curve1=tri:curve2=tri[final_audio]`
                    );
                }

                // Если нет фильтров от прошлого аудио потока
                else afade.push(
                    `[0:a]afade=t=in:st=0:d=${this._afade}[a0]`,
                    `[1:a]${args_filters.join(",")}[a1]`,
                    `[a0][a1]acrossfade=d=${this._afade}:curve1=tri:curve2=tri[final_audio]`
                );
                break;
            }
        }

        // Отдаем готовые фильтры
        return [
            "-filter_complex", afade.join(";"),
            "-map", "[final_audio]"
        ];
    };

    /**
     * @description Создаем класс и задаем параметры
     * @constructor
     * @protected
     */
    protected constructor(public options: AudioResourceOptions) {
        super();

        // Проверяем что-бы ссылка была ссылкой, а не пустышкой
        this.options.inputs = this.options.inputs.filter(i => i);
        this._afade =  this.options.inputs.length === 1 ? db.queues.options.fade : db.queues.options.swapFade;
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
            path["once"](event, (err: Error) => {
                if (event === "error") this.emit("error", Error(`AudioResource get ${err}`));
                options.events.destroy_callback(options.input);
            });
        }

        // Разовая функция для удаления потока
        this.once("close", () => options.events.destroy_callback(options.input));

        // Выполняем функцию декодирования
        return options.decode(options.input);
    };

    /**
     * @description Удаляем ненужные данные
     * @protected
     */
    public destroy() {
        Logger.log("DEBUG", `[AudioResource] has destroyed`);

        // Чистим все потоки от мусора
        this.emit("close");

        // Удаляем все вызовы функций
        super.destroy();

        this._readable = null;
        this.options = null;
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует ссылку или путь до файла в чистый opus для работы с discord
 * @usage Только для треков, до 8 мин!
 * @class BufferedAudioResource
 * @extends BaseAudioResource
 * @public
 *
 * # Класс буферизированного аудио
 * - Не более 8 мин, хранится в памяти.
 * - Может быть использован заново
 */
export class BufferedAudioResource extends BaseAudioResource {
    /**
     * @description Список аудио буферов, для временного хранения
     * @private
     */
    private _buffer = new AudioBuffer();

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable() {
        if (!this._buffer) return false;
        return this._buffer.position !== this._buffer.size;
    };

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public get duration() {
        if (!this._buffer || !this._buffer?.position) return 0;

        const time = this._buffer.position * OPUS_FRAME_SIZE;
        return time / 1e3 + this.options.seek;
    };

    /**
     * @description Выдаем фрагмент потока
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        if (!this._buffer) return null;
        return this._buffer.packet;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        if (!this._buffer) return 0;
        return this._buffer.size - this._buffer.position;
    };

    /**
     * @description Изменяем время проигрывания трека
     * @param seek - Время в сек
     * @public
     */
    public set seek(seek: number) {
        const index = (seek * 1e3) / OPUS_FRAME_SIZE;

        // Если указано неподходящие значение
        if (index > this._buffer.size || index < this._buffer.size) {
            this._buffer.position = 0;
            return;
        }

        this._buffer.position = index;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @constructor
     * @public
     */
    public constructor(config: AudioResourceOptions) {
        super(config);
        const decoder = new BufferedEncoder({
            highWaterMark: 512 * 5 // Буфер на ~1:14
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
                input.on("frame", (packet: Buffer) => {
                    if (this._buffer) {
                        // Сообщаем что поток можно начать читать
                        if (!this._readable) setImmediate(() => { this.emit("readable");});

                        // Если создал класс буфера, начинаем кеширование пакетов
                        if (packet) this._buffer.packet = packet;
                    }
                });
            }
        });

        // Процесс (FFmpeg)
        this.input<Process>({
            // Создание потока
            input: new Process(this.arguments),

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
                input.stdout.pipe(decoder);
            },
        });
    };

    /**
     * @description Обновление потока, без потерь
     * @public
     */
    /*public refresh = () => {
        this._buffer.position = 0;
        this._seek = 0;
    };*/

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy = () => {
        super.destroy();
        this._buffer?.clear();
        this._buffer = null;
    };
}

/**
 * @author SNIPPIK
 * @description Конвертирует ссылку или путь до файла в чистый opus для работы с discord
 * @usage Можно использовать любой тип аудио, хоть 20 часов
 * @class PipeAudioResource
 * @extends BaseAudioResource
 * @public
 *
 * # Класс потокового аудио
 * - Нет ограничения по времени, хранится в FFMPEG
 */
export class PipeAudioResource extends BaseAudioResource {
    /**
     * @description Реал тайм декодер opus фрагментов
     * @private
     */
    private encoder = new PipeEncoder({
        highWaterMark: 512 * 5 // Буфер на ~1:14
    });

    /**
     * @description Кол-во проигранных пакетов
     * @private
     */
    private played = 0;

    /**
     * @description Если чтение возможно
     * @public
     */
    public get readable(): boolean {
        return this._readable;
    };

    /**
     * @description Выдаем фрагмент потока
     * @help (время пакета 20ms)
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
        if (!this.played) return 0;

        const time = this.played * OPUS_FRAME_SIZE;
        return time / 1e3 + this.options.seek;
    };

    /**
     * @description Изменяем время проигрывания трека
     * @param seek - Время в сек
     * @public
     */
    public set seek(seek: number) {
        let steps = ((seek * 1e3) / OPUS_FRAME_SIZE);

        // Если диапазон слишком мал или большой
        if (steps >= 0 || steps > this.packets) return;

        // Пропускаем аудио фреймы
        do {
            steps--;
            this.encoder.read();
        } while (steps > 0)
    };

    /**
     * @description Создаем класс и задаем параметры
     * @param config - Настройки кодировщика
     * @public
     */
    public constructor(config: AudioResourceOptions) {
        super(config);

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
                input.once("readable", () => {
                    this._readable = true;
                    this.emit("readable");
                });
            }
        });

        // Процесс (FFmpeg)
        this.input<Process>({
            // Создание потока
            input: new Process(this.arguments),

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
        super.destroy();
        this.played = null;
        this.encoder = null;
    };
}




/**
 * @author SNIPPIK
 * @description Параметры для создания класса AudioResource
 * @interface AudioResourceOptions
 */
interface AudioResourceOptions {
    inputs: string[];
    volume: number;

    seek?: number;
    old_seek?: number;

    filters: string;
    old_filters?: string;

    /**
     * @description Параметры для fade режима
     * @public
     */
    crossfade?: {
        duration: number
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
        path?: string;
    };

    /**
     * @description Как начать передавать данные из потока
     * @readonly
     */
    readonly decode: (input: T) => void;
}