import { AudioResource } from "#service/voice";

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком, хранит в себе все данные потока
 * @class PlayerAudio
 * @public
 */
export class PlayerAudio<T extends AudioResource> {
    /**
     * @description Поток, расшифровывает ogg/opus в чистый opus он же sl16e
     * @private
     */
    private _audio: T;

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
     * @param stream
     */
    public set current(stream) {
        const oldStream = this._audio;

        // Перезаписываем текущий поток
        this._audio = stream;

        // Если есть активный поток
        if (oldStream) oldStream.destroy();
    };
}