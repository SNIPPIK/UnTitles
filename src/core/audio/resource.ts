import { BufferedEncoder, OPUS_FRAME_SIZE, PipeEncoder } from "./opus";
import { Logger } from "#structures/logger";
import { TypedEmitter } from "#structures";
import type { Track } from "#core/queue";
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
     * @description Модификатор скорости фильтров
     * @protected
     */
    protected _afade_modificator = 1;

    /**
     * @description Модификатор скорости высчитанный из фильтров
     * @public
     */
    public get speed() {
        return this._afade_modificator;
    };

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
     * @protected
     */
    protected get arguments(): string[] {
        const { seek, track } = this.options;
        const args = [
            "-ss", `${seek ?? 0}`,
            "-i", track.link,
        ];

        if (track.isBuffered) args.unshift("-accurate_seek");

        return [
            "-vn",
            ...args,
            ...this.filters,

            // Указываем формат аудио (ogg/opus)
            "-acodec", "libopus",
            "-frame_duration", "20",
            "-f", "opus",
            "pipe:1"
        ];
    };

    /**
     * @description Собираем фильтры для ffmpeg
     * @protected
     */
    protected get filters(): string[] {
        const { volume, filters, track, seek } = this.options;
        const afade = [
            `volume=${volume / 150}`
        ];

        // Если есть используемые фильтры
        if (filters) afade.unshift(filters);

        // Добавляем стартовое время приглушения
        afade.push(`afade=t=in:st=0:d=${this._afade}`);

        // Если можно использовать приглушение
        if (track.time.total > 0) {
            afade.push(
                `afade=t=out:st=${Math.max(track.time.total, seek - track.time.total - db.queues.options.fade)}:d=${db.queues.options.fade}`
            );
        }

        // Отдаем готовые фильтры
        return [
            "-af", afade.join(",")
        ];
    };

    /**
     * @description Создаем класс и задаем параметры
     * @constructor
     * @protected
     */
    protected constructor(public options: AudioResourceOptions) {
        super();
        // Ищем модификатор скорости (asetrate, tempo)
        let modificator: number = 1.0;

        try {
            // Иначе проверяем текущие фильтры
            if (options.filters) modificator = Math.max(1.0, getSpeedMultiplier(options.filters));
        } catch (error) {
            console.log(error);
        }

        this._afade_modificator = modificator;
        this._afade = !this.options.swapped ? db.queues.options.fade : db.queues.options.swapFade;
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
                if (event === "error") this.emit("error", new Error(`AudioResource get ${err}`));
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
        this.encoder = null;
    };
}


/**
 * @author SNIPPIK
 * @description Регулярное выражение для захвата числового множителя из строки 'asetrate=48000*X'.
 * @example "asetrate=48000*1.2" -> "1.2"
 * @const ASSETRATE_MULTIPLIER_PATTERN
 * @private
 */
const ASSETRATE_MULTIPLIER_PATTERN = /^asetrate=48000\*([\d\.]+)(?:,.*)?$/;

/**
 * @author SNIPPIK
 * @description Регулярное выражение для захвата числового множителя из строки 'atempo=X'.
 * @example "atempo=2" -> "2"
 * @const ATEMPO_MULTIPLIER_PATTERN
 * @private
 */
const ATEMPO_MULTIPLIER_PATTERN = /^atempo=([\d\.]+)(?:,.*)?$/;

/**
 * @author SNIPPIK
 * @description Извлекает числовой множитель (rate) из фильтра asetrate.
 * @param filtersString Строка фильтров FFmpeg.
 * @returns Извлеченное значение как строка, или null.
 * @function extractAsetrateMultiplier
 * @private
 */
function extractAsetrateMultiplier(filtersString: string): string | null {
    const match = filtersString.match(ASSETRATE_MULTIPLIER_PATTERN);
    return match ? match[1] : null;
}

/**
 * @author SNIPPIK
 * @description Извлекает числовой множитель (rate) из фильтра atempo.
 * @param filtersString Строка фильтров FFmpeg.
 * @returns Извлеченное значение как строка, или null.
 * @function extractAtempoMultiplier
 * @private
 */
function extractAtempoMultiplier(filtersString: string): string | null {
    const match = filtersString.match(ATEMPO_MULTIPLIER_PATTERN);
    return match ? match[1] : null;
}

/**
 * @author SNIPPIK
 * @description Центральная функция для получения множителя скорости (Speed Multiplier)
 * из строки фильтров, проверяя сначала asetrate, затем atempo.
 * @param filtersString Строка фильтров FFmpeg.
 * @returns Числовой множитель скорости или 1.0, если не найден.
 * @function getSpeedMultiplier
 * @private
 */
function getSpeedMultiplier(filtersString: string): number {
    if (!filtersString) return 1.0;

    // Извлекаем множитель asetrate
    const asetrateStr = extractAsetrateMultiplier(filtersString);

    // Конвертируем в число. Если не найдено, используем 1.0 (нет изменения)
    const asetrateMultiplier = asetrateStr ? parseFloat(asetrateStr) : 1.0;

    // Извлекаем множитель atempo
    const atempoStr = extractAtempoMultiplier(filtersString);

    // Конвертируем в число. Если не найдено, используем 1.0 (нет изменения)
    const atempoMultiplier = atempoStr ? parseFloat(atempoStr) : 1.0;

    // Общий множитель - это произведение (умножение) двух эффектов.
    const totalMultiplier = asetrateMultiplier * atempoMultiplier;

    // Проверка на NaN и возврат результата.
    return isNaN(totalMultiplier) ? 1.0 : totalMultiplier;
}


/**
 * @author SNIPPIK
 * @description Параметры для создания класса AudioResource
 * @interface AudioResourceOptions
 * @private
 */
interface AudioResourceOptions {
    /**
     * @description Трек который надо включить
     * @public
     */
    track: Track;

    /**
     * @description Громкость аудио потока
     * @public
     */
    volume: number;

    /**
     * @description Время пропуска, с этой временной точки включится аудио
     * @public
     */
    seek?: number;

    /**
     * @description Фильтры ffmpeg для включения через filter_complex
     * @public
     */
    filters: string;

    /**
     * @description Смена аудио потока?
     * @public
     */
    swapped: boolean;
}

/**
 * @author SNIPPIK
 * @description События аудио потока
 * @interface AudioResourceEvents
 * @private
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
 * @private
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
    readonly decode?: (input: T) => void;
}