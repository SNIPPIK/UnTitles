import { FfmpegProcess, AudioEngine, type iType } from "#native";
import { OPUS_FRAME_SIZE, SILENT_FRAME } from "#core/audio/opus";
import { FFMPEG_PATH } from "#core/audio/process";
import { TypedEmitter } from "#structures";
import type { Track } from "#core/queue";
import { env } from "#app/env";
import { db } from "#app/db";

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

        // Если платформа не может играть нативно из сети
        if (this.options.track.proxy && track.link.startsWith("http")) {
            const proxy = env.get("APIs.proxy", null);

            // Если есть прокси
            if (proxy) {
                const isSocks = proxy.startsWith("socks");

                // Если протокол socks
                if (isSocks) {
                    const path = proxy.split(":/")[1];

                    // Если нашлись данные для входа
                    if (path.match(/@/)) {
                        args.unshift("-http_proxy", `http:/${proxy.split(":/")[1].split("@")[1]}`);
                    }

                    // Если данных для входа нет
                    else args.unshift("-http_proxy", `http:/${proxy.split(":/")[1]}`);
                }

                // Если протокол http
                else args.unshift("-http_proxy", `http:/${proxy.split(":/")[1]}`);
            }
        }

        return [
            ...args,

            // Аудио фильтры
            "-af", this.filters,

            // Указываем формат аудио (ogg/opus)
            "-c:a", "libopus",
            "-frame_duration", "20",
            "-vbr", "on",
            "-compression_level", "10",
            "-application", "audio",
            "-f", "ogg",
            "pipe:1"
        ];
    };

    /**
     * @description Собираем фильтры для ffmpeg
     * @protected
     */
    protected get filters(): string {
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
        return afade.join(",");
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
            this.emit("error", error as Error);
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
        if (options.events.destroy) {
            // Запускаем все события
            for (const event of options.events.destroy) {
                const path = options.events.path ? options.input[options.events.path] : options.input;

                // Запускаем прослушивание события
                path["once"](event, (err: Error) => {
                    if (event === "error") this.emit("error", new Error(`AudioResource get ${err}`));
                    options.events.destroy_callback(options.input);
                });
            }
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
        // Чистим все потоки от мусора
        this.emit("close", `[AudioResource] has destroyed`);

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
 * @class AudioResource
 * @extends BaseAudioResource
 * @public
 */
export class AudioResource extends BaseAudioResource {
    private engine: iType<typeof AudioEngine>;
    private process: iType<typeof FfmpegProcess>;
    private _played_frames = 0;

    /**
     * @description Выдаем фрагмент потока
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        if (!this.engine?.size) return null;

        const frame: Buffer = this.engine.packet;
        if (frame) this._played_frames++;
        return frame;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        return this.engine.size;
    };

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public get duration(): number {
        const currentPosition = this._played_frames

        const time = currentPosition * OPUS_FRAME_SIZE;
        return time / 1e3 + this.options.seek;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @constructor
     * @public
     */
    public constructor(config: AudioResourceOptions) {
        super(config);

        const { isBuffered } = this.options.track;

        // Создаем аудио движок в Rust
        this.engine = new AudioEngine(isBuffered ? 10 : 20);
        this.process = new FfmpegProcess(this.arguments, FFMPEG_PATH);

        // Привязываем события через внутренний метод input
        this.input({
            events: {
                destroy_callback: (p) => {
                    p.destroy();
                }
            },
            input: this.process,
            decode: (p) => p.pipeStdout((frames) => {
                // Загружаем фрагменты полученные в процессе парсинга
                for (let {type, data} of frames) {
                    if (type === "frame") {
                        if (!this._readable) {
                            this.engine.addPacket(SILENT_FRAME);
                            this._readable = true;
                            setImmediate(() => this.emit("readable"));
                        }

                        this.engine.addPacket(data);
                    }
                }
            })
        });
    };

    /**
     * @description Удаляем ненужные данные
     * @public
     */
    public destroy() {
        this.engine.addPacket(SILENT_FRAME);

        if (this.process) {
            this.process.destroy();
            this.process = null;
        }

        if (this.engine) {
            this.engine.clear();
            this.engine = null;
        }

        super.destroy();
    };
}

/**
 * @author SNIPPIK
 * @description Регулярное выражение для захвата числового множителя из строки 'asetrate=48000*X'.
 * @example "asetrate=48000*1.2" -> "1.2"
 * @const ASSETRATE_MULTIPLIER_PATTERN
 * @private
 */
const ASSETRATE_MULTIPLIER_PATTERN = /(?:^|,)asetrate=48000\*([\d\.]+)/;

/**
 * @author SNIPPIK
 * @description Регулярное выражение для захвата числового множителя из строки 'atempo=X'.
 * @example "atempo=2" -> "2"
 * @const ATEMPO_MULTIPLIER_PATTERN
 * @private
 */
const ATEMPO_MULTIPLIER_PATTERN = /(?:^|,)atempo=([\d\.]+)/;

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
    readonly "close": (status?: string) => void;

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
        destroy?: string[];

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