import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Нативная реализация парсинга на C++
 */
const NativeOpus: { OggOpusParser: new () => NativeOggOpusParser } = require('../../../Release/opus_native.node');

/**
 * @author SNIPPIK
 * @description Интерфейс нативная реализация парсинга на C++
 * @private
 */
interface NativeOggOpusParser {
    /**
     * @description Метод парсинга страницы
     * @param chunk    -
     * @param callback -
     * @return void
     * @public
     */
    readonly parse: (chunk: Buffer, callback: (type: keyof EncoderEvents, frame: Buffer, meta: {channels: number, sampleRate: number}) => void) => void;

    /**
     * @description Метод очистки памяти C++ кода
     * @public
     */
    readonly destroy: () => void;
}

/**
 * @author SNIPPIK
 * @description Прослойка между JS кодом и C++
 * @class OggOpusParser
 * @extends TypedEmitter
 * @private
 */
export class OggOpusParser extends TypedEmitter<EncoderEvents> {
    /** Запущенный инстанс */
    private instance: NativeOggOpusParser;

    /**
     * @description Загружаем данные класса для парсинга аудио
     * @public
     */
    public constructor() {
        super();
        this.instance = new NativeOpus.OggOpusParser();
    };

    /**
     * @description Парсим данные аудио и получаем opus фрагменты
     * @param chunk - Raw OGG фрагмент
     * @public
     */
    public parseAvailablePages(chunk: Buffer) {
        try {
            // C++ вызывает этот колбэк синхронно для каждого найденного пакета
            this.instance.parse(chunk, (type, frame) => {
                this.emit(type, frame);
            });
        } catch (err) {
            this.emit("error", err as Error);
        }
    };

    /**
     * @description Чистим класс от мусора
     * @public
     */
    public destroy() {
        super.destroy();

        this.instance.destroy();
        this.instance = null;
    };
}

/**
 * @author SNIPPIK
 * @description События для типизации декодера
 * @interface EncoderEvents
 * @private
 */
interface EncoderEvents {
    /**
     * @description Получение opus фрейма заголовка
     * @param frame - head фрагмент
     */
    "head": (frame: Buffer) => void;

    /**
     * @description Получение opus фрейма тега
     * @param frame - tag фрагмент
     */
    "tags": (frame: Buffer) => void;

    /**
     * @description Получение основного opus фрейма
     * @param frame - Основной фрагмент opus потока
     */
    "frame": (frame: Buffer) => void;

    /**
     * @description Получение ошибки при конвертировании аудио
     * @param error - ошибка
     */
    "error": (error: Error) => void;
}