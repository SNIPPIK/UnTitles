import { OPUS_FRAME_SIZE } from "#core/audio/opus.js";
import { FFMPEG_PATH } from "#core/audio/process.js";
import { AudioEngine, type iType } from "#native";
import type { Track } from "#core/queue/index.js";
import { TypedEmitter } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Параметры encoders в FFmpeg
 * @const ENCODER_PARAMS
 * @private
 */
const ENCODER_PARAMS = {
    /**
     * # Параметры
     * - voip - Способствует улучшению разборчивости речи, discord лучше работает с этим режимом
     * - audio - Поддерживайте верность вводимым данным (по умолчанию).
     * - lowdelay - Ограничьтесь только режимами с наименьшей задержкой, отключив режимы, оптимизированные для передачи голоса.
     */
    mode: "voip",

    /**
     * # Параметры
     * - off - Используйте кодирование с постоянной скоростью передачи данных.
     * - on - Используйте кодировку с переменной скоростью передачи данных (по умолчанию).
     */
    vbr: "off",

    /** Потери при кодировании */
    lost: {
        /** Разрешаем терять n пакетов за 1 поток */
        total: "0",

        /** Можно ли сглаживать потери, заполнять пустотой. (Не рекомендуется включать) */
        fec: "off"
    }
};

/**
 * @author SNIPPIK
 * @description Базовый класс для создания аудио
 * @class BaseAudioResource
 * @extends TypedEmitter<AudioResourceEvents>
 * @abstract
 */
export class AudioResource extends TypedEmitter<AudioResourceEvents> {
    protected engine: iType<typeof AudioEngine> = new AudioEngine(10);

    /** Кол-во отданных пакетов */
    protected _played_frames = 0;

    /** Последнее заданное значение затухания */
    protected _afade = 0;

    protected _timeout: NodeJS.Timeout;

    /**
     * @description Геттер состояния чтения, можно ли читать аудио поток
     * @public
     */
    public get readable(): boolean {
        return this.engine.size > 0;
    };

    /**
     * @description Выдаем фрагмент потока
     * @help (время пакета 20ms)
     * @return Buffer
     * @public
     */
    public get packet(): Buffer {
        if (!this.engine?.size) return null;

        const frame: Buffer = this.engine.packet;
        if (frame) {
            this.hasPossibleBuffedStream;
            this._played_frames++;
        }
        return frame;
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

        const time = currentPosition * OPUS_FRAME_SIZE;
        return time / 1e3 + this.options.seek;
    };

    /**
     * @description Можно ли передавать аудио в буфер аудио потока
     * @private
     */
    private get hasPossibleBuffedStream() {
        const audio = this.engine;

        // Если буфер почти полон (на 80%), ставим FFmpeg на паузу
        if (!audio.canAcceptThreshold(80)) {
            audio.pause = true;
            return false;
        }

        // Если в буфере стало просторно (меньше 40%), возобновляем чтение
        else if (audio.canAcceptThreshold(40)) audio.pause = false;
        return true;
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
            "-vbr", ENCODER_PARAMS.vbr,
            "-frame_duration", "20",
            "-fec", ENCODER_PARAMS.lost.fec,
            "-packet_loss", ENCODER_PARAMS.lost.total,
            "-application", ENCODER_PARAMS.mode,
            "-f", "ogg",
            "pipe:1"
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
        this._afade = !this.options.swapped ? db.queues.options.fade : db.queues.options.swapFade;

        // Запускаем получение аудио
        this.engine.start(this.arguments, FFMPEG_PATH);

        // Запускаем цикл для получения ответа от движка
        this._timeout = setInterval(() => {
            if (this.readable) {
                clearInterval(this._timeout);
                this.emit("readable");
            }
        }, 100);
    };

    /**
     * @description Получаем пакеты
     * @param size - Кол-во пакетов
     * @public
     */
    public packetAt = (size: number) => {
        const frames = this.engine.getPackets(size);
        if (frames) {
            this.hasPossibleBuffedStream;
            this._played_frames += frames.length;
        }
        return frames;
    };

    /**
     * @description Удаляем ненужные данные
     * @protected
     */
    public destroy() {
        clearInterval(this._timeout);

        // Чистим все потоки от мусора
        this.emit("close", `[AudioResource] has destroyed`);

        // Удаляем все вызовы функций
        super.destroy();

        // Проверяем есть ли аудио
        if (this.engine) {
            this.engine.clear();
            this.engine = null;
        }

        this.options = null;
        this._played_frames = 0;
    };
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