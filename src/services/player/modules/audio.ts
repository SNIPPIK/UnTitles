import {AudioResource} from "@service/voice";

/**
 * @author SNIPPIK
 * @description Класс для управления включенным потоком, хранит в себе все данные потока
 * @class PlayerAudio
 * @protected
 */
export class PlayerAudio {
    /**
     * @description Поток, расшифровывает ogg/opus в чистый opus он же sl16e
     * @private
     */
    private _audio: AudioResource = null;

    /**
     * @description Текущий стрим
     * @return AudioResource
     * @public
     */
    public get current() { return this._audio; };

    /**
     * @description Подключаем новый поток
     * @param stream
     */
    public set current(stream) {
        // Если уже есть поток
        if (this.current) {
            if (this.current?.stream) this.current.destroy();
            this._audio = null;
        }

        // Подключаем новый поток
        this._audio = stream;
    };
}