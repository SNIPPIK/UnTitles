import { BufferedAudioResource, PipeAudioResource } from "#core/audio";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Время ожидания потока live трека
 * @const TIMEOUT_STREAM_PIPE
 * @private
 */
const TIMEOUT_STREAM_PIPE = 13000;

/**
 * @author SNIPPIK
 * @description Время ожидания потока трека
 * @const TIMEOUT_STREAM_BUFFERED
 * @private
 */
const TIMEOUT_STREAM_BUFFERED = 8000;

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком, хранит в себе все данные потока
 * @class PlayerAudio
 * @public
 *
 * # Модуль для плеера
 * - Хранит в себе метаданные об аудио включая аудио
 */
export class PlayerAudio<T extends BufferedAudioResource | PipeAudioResource> {
    /**
     * @description Поток, расшифровывает ogg/opus в чистый opus он же sl16e
     * @private
     */
    private _audio: T | null;

    /**
     * @description Поток, находящийся в ожидании загрузки и проигрывания
     * @private
     */
    private _pre_audio: T | null;

    /**
     * @description Таймер чтения аудио потока, для авто удаления
     * @private
     */
    private _timeout: NodeJS.Timeout | null;

    /**
     * @description Громкость аудио, по умолчанию берется параметр из db/env
     * @private
     */
    private _volume = db.queues.options.volume;

    /**
     * @description Изменяем значение громкости у аудио
     * @param volume - Громкость допустимый диапазон (10-200)
     * @public
     */
    public set volume(volume: number) {
        // Меняем параметр
        this._volume = volume > 200 ? 200 : volume < 1 ? 10 : volume;
    };

    /**
     * @description Текущая громкость аудио
     * @public
     */
    public get volume() {
        return this._volume;
    };

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get current() {
        return this._audio;
    };

    /**
     * @description Есть ли пред-загруженное аудио
     * @public
     */
    public get preloaded() {
        return !!this._pre_audio;
    };

    /**
     * @description Пред-загрузка аудио потока для использования и замены текущего потока
     * @param stream
     * @public
     */
    public set preload(stream: T) {
        // Если уже есть пред-загруженное аудио
        if (this._pre_audio) {
            clearTimeout(this._timeout);
            this._pre_audio.destroy();
        }

        // Записываем аудио в пред-загруженные
        this._pre_audio = stream;

        // Установка таймера ожидания
        const waitTime = stream.options.crossfade.duration !== 0 ? TIMEOUT_STREAM_BUFFERED : TIMEOUT_STREAM_PIPE;
        this._timeout = setTimeout(() => {
            stream.emit("error", Error("Timeout: the stream has been exceeded!"));
        }, waitTime);

        // Отслеживаем аудио поток на ошибки
        (stream as BufferedAudioResource).once("error", () => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            // Уничтожаем новый аудио поток
            stream.destroy();
            this._pre_audio = null;
        });

        // Отслеживаем аудио поток на готовность к чтению
        (stream as BufferedAudioResource).once("readable", () => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            // Если есть активный поток
            if (this._audio) {
                // Догоняем ожидание аудио потока
                //stream.seek = this._audio.duration + 1;
                this._audio.destroy();
            }

            // Перезаписываем текущий поток
            this._audio = stream;
            this._pre_audio = null;
        });
    };

    /**
     * @description Эта функция полностью удаляет audio модуль и все сопутствующие данные
     * @public
     */
    public destroy = () => {
        this._audio?.destroy();
        this._audio = null;

        this._pre_audio?.destroy();
        this._pre_audio = null;

        clearTimeout(this._timeout);
        this._timeout = null;
    };
}