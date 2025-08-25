import { BufferedAudioResource, PipeAudioResource } from "#core/audio";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком, хранит в себе все данные потока
 * @class PlayerAudio
 * @public
 */
export class PlayerAudio<T extends BufferedAudioResource | PipeAudioResource> {
    /**
     * @description Поток, расшифровывает ogg/opus в чистый opus он же sl16e
     * @private
     */
    private _audio: T;

    /**
     * @description Громкость аудио, по умолчанию берется параметр из db/env
     * @protected
     */
    private _volume = db.queues.options.volume;

    /**
     * @description Параметр отвечающий за загрузку потока
     * @help Если поток загружается или ждет начала, то новый загрузить не получится
     */
    public waitStream = false;

    /**
     * @description Изменяем значение громкости у аудио
     * @param vol - Громкость допустимый диапазон (10-200)
     * @public
     */
    public set volume(vol: number) {
        if (vol > 200) vol = 200;
        else if (vol < 10) vol = 10;

        // Меняем параметр
        this._volume = vol;
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
     * @description Подключаем новый поток
     * @param stream - Аудио поток
     * @public
     */
    public set current(stream) {
        const oldStream = this._audio;

        // Перезаписываем текущий поток
        this._audio = stream;

        // Если есть активный поток
        if (oldStream) oldStream.destroy();
    };

    /**
     * @description Эта функция полностью удаляет audio модуль и все сопутствующие данные
     * @public
     */
    public destroy = () => {
        this._audio?.destroy();
        this._audio = null;
        this.waitStream = null;
    };
}