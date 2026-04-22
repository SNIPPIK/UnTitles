import { TRACK_CHECK_WAIT } from "#core/queue/controllers/provider";
import { AudioResource } from "#core/audio";
import { Logger } from "#structures";
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
export class PlayerAudio<T extends AudioResource> {
    /** Поток, расшифровывает ogg/opus в чистый opus он же PCM */
    private _audio: T | null;

    /** Поток, находящийся в ожидании загрузки и проигрывания */
    private _pre_audio: T | null;

    /** Таймер чтения аудио потока, для авто удаления */
    private _timeout: NodeJS.Timeout | null;

    /** Громкость аудио, по умолчанию берется параметр из db/env */
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
     * @description Индикатор громкости
     * @returns string
     * @private
     */
    public get volumeIndicator(): string {
        const clamped = Math.max(0, Math.min(this._volume, 200));
        let text = "";

        if (clamped < 30) text+= "🔈";
        else if (clamped >= 30 && clamped < 70) text+= "🔉";
        else if (clamped >= 70 && clamped < 150) text+= "🔊";
        else if (clamped >= 150) text+= "📢";

        return text + ` ${clamped}%`;
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
        this._timeout = setTimeout(() => {
            stream.emit("error", Error("Timeout: the stream has been exceeded!"));
        }, TRACK_CHECK_WAIT);

        // Отслеживаем аудио поток на ошибки
        stream.once("error", (error) => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            // Уничтожаем новый аудио поток
            stream.destroy();
            this._pre_audio = null;

            Logger.log("ERROR", error);
        })

        // Отслеживаем аудио поток на готовность к чтению
        .once("readable", () => {
            // Удаляем таймер
            clearTimeout(this._timeout);

            // Если есть активный поток
            if (this._audio) {
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