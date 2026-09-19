import { FFMPEG_PATH, FFMPEG_PROXY } from "#core/audio/process.js";
import { createProxyFFmpeg, TypedEmitter } from "#structures";
import { OPUS_FRAME_SIZE } from "#core/audio/opus.js";
import { AudioEngine, type iType } from "#native";
import type { Track } from "#core/queue/index.js";
import { env } from "#db/env";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Параметры encoders в FFmpeg
 * @const ENCODER_PARAMS
 * @private
 */
const ENCODER_PARAMS = {
    mode: env.get("decoder.type", "audio")
};

/**
 * @author SNIPPIK
 * @description Базовый класс для создания аудио
 * @class BaseAudioResource
 * @extends TypedEmitter<AudioResourceEvents>
 * @abstract
 */
export class AudioResource extends TypedEmitter<AudioResourceEvents> {
    protected engine: iType<typeof AudioEngine> = new AudioEngine(2);

    /** Защита от повторного destroy */
    protected _destroyed = false;

    /** Кол-во отданных пакетов */
    protected _played_frames = 0;

    /** Последнее заданное значение затухания */
    protected _afade = 0;

    /** Модификатор скорости фильтров */
    protected _afade_modificator = 1;

    /** Таймер для отслеживания данных от AudioEngine */
    protected _timeout: NodeJS.Timeout;

    /**
     * @description Геттер состояния чтения, можно ли читать аудио поток
     * @public
     */
    public get readable(): boolean {
        return this.engine?.size > 0;
    };

    /**
     * @description Оставшееся кол-во пакетов
     * @help (время пакета 20ms)
     * @public
     */
    public get packets(): number {
        return this.engine?.size ?? 0;
    };

    /**
     * @description Duration в секундах с учётом текущей позиции в буфере и seek-а (предыдущего смещения)
     * @public
     */
    public get duration(): number {
        const currentPosition = this._played_frames

        const time = currentPosition * (OPUS_FRAME_SIZE * this._afade_modificator);
        return time / 1e3 + this.options.seek;
    };

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

        if (!track.isLive) args.unshift("-accurate_seek");

        // Если платформа не может играть нативно из сети
        if (this.options.track.proxy && track.link.startsWith("http") && FFMPEG_PROXY) {
            // Если есть прокси
            args.unshift("-http_proxy", createProxyFFmpeg(FFMPEG_PROXY));
        }

        return [
            ...args,

            // Аудио фильтры
            "-af", this.filters,
            "-application", `${ENCODER_PARAMS.mode}`,
        ];
    };

    /**
     * @description Собираем фильтры для FFmpeg
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
     * @public
     */
    public constructor(public options: AudioResourceOptions) {
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

        // Запускаем получение аудио
        this.engine.start(this.arguments, FFMPEG_PATH);

        if (!this.readable) {
            const check = () => {
                if (this.readable) {
                    this.emit("readable");
                    return;
                }

                this._timeout = setTimeout(check, 10);
            };
            setImmediate(check); // первая проверка почти мгновенно
        }

        // Сообщаем о запуске потока
        else this.emit("readable");
    };

    /**
     * @description Получаем пакеты
     * @param size - Кол-во пакетов
     * @public
     */
    public packetAt = (size: number) => {
        const frames = this.engine.getPackets(size);
        if (frames) this._played_frames += frames.length;
        return frames;
    };

    /**
     * @description Удаляем ненужные данные
     * @protected
     */
    /**
     * Уничтожает ресурс: останавливает таймеры, освобождает нативный движок,
     * удаляет ссылки на опции и счётчики, снимает все слушатели.
     *
     * Идемпотентен: повторный вызов после уничтожения не выполняет действий.
     */
    public destroy() {
        // Защита от повторного вызова
        if (this._destroyed) return;
        this._destroyed = true;

        // Уведомляем слушателей о закрытии
        this.emit(
            "close",
            `[AudioResource] has destroyed`
        );

        // Останавливаем polling (если используется)
        if (this._timeout) {
            clearTimeout(this._timeout);
            this._timeout = null;
        }

        // Забираем engine локально и сразу обнуляем ссылку
        const engine = this.engine;

        // Останавливаем нативные ресурсы: очистка буфера и destroy
        engine.destroy();

        // Убираем ссылки на большие данные
        this.options = null;
        this._played_frames = null;
        this._afade = null;
        this.engine = null;

        // Удаляем всех слушателей (вызов родительского destroy)
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
const ASSETRATE_MULTIPLIER_PATTERN = /(?:^|,)asetrate=48000\*([\d.]+)/;

/**
 * @author SNIPPIK
 * @description Регулярное выражение для захвата числового множителя из строки 'atempo=X'.
 * @example "atempo=2" -> "2"
 * @const ATEMPO_MULTIPLIER_PATTERN
 * @private
 */
const ATEMPO_MULTIPLIER_PATTERN = /(?:^|,)atempo=([\d.]+)/;

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
    /** Трек который надо включить */
    track: Track;

    /** Громкость аудио потока */
    volume: number;

    /** Время пропуска, с этой временной точки включится аудио */
    seek?: number;

    /** Фильтры FFmpeg для включения через af */
    filters: string;

    /** Смена аудио потока? */
    swapped: boolean;
}

/**
 * @author SNIPPIK
 * @description События аудио потока
 * @interface AudioResourceEvents
 * @private
 */
interface AudioResourceEvents {
    /** События при котором можно начинать чтение потока */
    readonly "readable": () => void;

    /** Событие при котором поток удален */
    readonly "end": () => void;

    /** Событие при котором поток начнет уничтожатся */
    readonly "close": (status?: string) => void;

    /** Событие при котором поток получил ошибку */
    readonly "error": (error: Error) => void;
}