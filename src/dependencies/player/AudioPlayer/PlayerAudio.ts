import {AudioResource} from "@lib/voice/audio/Opus";

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
        // Если есть текущий поток
        if (this._audio) {
            if (this.current?.stream) {
                this.current.stream.emit("close");
                this.current.stream.end();
                this.current.destroy();
            }
            this._audio = null;
        }

        // Подключаем новый поток
        this._audio = stream;
    };
}