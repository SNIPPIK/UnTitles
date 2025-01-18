import {AudioQueues} from "./AudioQueues";
import {AudioCycles} from "./AudioCycles";
import {env} from "@env";

/**
 * @author SNIPPIK
 * @description Коллекция для взаимодействия с modules
 * @class dbl_audio
 * @public
 */
export class dbl_audio {
    /**
     * @description Хранилище очередей
     * @readonly
     * @private
     */
    private readonly _queue = new AudioQueues();

    /**
     * @description Хранилище циклов для работы музыки
     * @readonly
     * @private
     */
    private readonly _cycles = new AudioCycles();

    /**
     * @description Здесь хранятся модификаторы аудио
     * @readonly
     * @private
     */
    private readonly _options = {
        volume: parseInt(env.get("audio.volume")),
        fade: parseInt(env.get("audio.fade")),
        optimization: parseInt(env.get("duration.optimization"))
    };

    /**
     * @description Получаем циклы процесса
     * @return CollectionCycles
     * @public
     */
    public get cycles() { return this._cycles; };

    /**
     * @description Выдаем данные для запуска AudioResource
     * @public
     */
    public get options() { return this._options; };

    /**
     * @description Получаем CollectionQueue
     * @return CollectionQueue
     * @public
     */
    public get queue() { return this._queue; };
}