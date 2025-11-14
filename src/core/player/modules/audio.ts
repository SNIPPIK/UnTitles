import { BufferedAudioResource, PipeAudioResource } from "#core/audio";
import { db } from "#app/db";

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
    private _audio: T | null = null;

    /**
     * @description Поток, находящийся в ожидании загрузки и проигрывания
     * @private
     */
    private _pre_audio: T | null = null;

    /**
     * @description Таймер чтения аудио потока, для авто удаления
     * @private
     */
    private _timeout: NodeJS.Timeout | null = null;

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
            this._pre_audio = null;
        }

        // Записываем аудио в пред-загруженные
        this._pre_audio = stream;

        // Если аудио поток не ответил в течении указанного времени
        this._timeout = setTimeout(() => {
            // Отправляем данные событию для отображения ошибки
            stream.emit("error", new Error("Timeout: the stream has been exceeded!"));
        },
            // Если играет трек, а не live!
            stream.options.filters ? 8e3 : 13e3);

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
            if (this._audio) this._audio.destroy();

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