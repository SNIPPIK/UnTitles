import { OggOpusParser as OpusParser } from "#native";
import { TypedEmitter } from "#structures";
import { SILENT_FRAME } from "#core/audio";

/**
 * @author SNIPPIK
 * @description Прослойка между JS кодом и C++
 * @class OggOpusParser
 * @extends TypedEmitter
 * @private
 */
export class OggOpusParser extends TypedEmitter<EncoderEvents> {
    /** Запущенный инстанс */
    private instance: any;

    /** Надо ли отправить 1 калибровочный пустой пакет */
    private first = true;

    /**
     * @description Загружаем данные класса для парсинга аудио
     * @public
     */
    public constructor() {
        super();
        this.instance = new OpusParser();
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
                if (this.first && type === "frame") {
                    this.first = undefined;
                    this.emit("frame", SILENT_FRAME);
                }

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