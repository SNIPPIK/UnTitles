import { HeartbeatManager } from "#core/voice/managers/heartbeat";
import { VoiceOpcodes } from "discord-api-types/voice";
import { VoiceConnection } from "#core/voice";

/**
 * @author SNIPPIK
 * @description Время через которое делается проверка speaking статус
 * @const KEEP_SWITCH_SPEAKING
 */
const KEEP_SWITCH_SPEAKING = 60e3;

/**
 * @author SNIPPIK
 * @description Максимальное значение счетчика активности
 * @private
 */
const MAX_SIZE_VALUE = 2 ** 32 - 1;

/**
 * @author SNIPPIK
 * @description Класс управляющий голосовым состоянием спикера
 * @class VoiceSpeakerManager
 * @public
 */
export class VoiceSpeakerManager {
    /**
     * @description Текущий тип спикера
     * @private
     */
    private _type: SpeakerType = SpeakerType.disable;

    /**
     * @description Список клиентов в голосовом состоянии
     * @private
     */
    public clients = new Set<string>();

    /**
     * @description Менеджер жизни спикера
     * @private
     */
    private _heartbeat: HeartbeatManager;

    /**
     * @description Данные для поддержания подключения UDP
     * @private
     */
    private keepAlive = {
        /**
         * @description Буфер, используемый для записи счетчика активности
         * @readonly
         * @private
         */
        buffer: Buffer.alloc(4),

        /**
         * @description Счетчика активности
         * @private
         */
        counter: 0
    };

    /**
     * @description Указанный тип спикера
     * @private
     */
    public get default(): SpeakerType {
        return this.voice.configuration.self_speaker ?? SpeakerType.enable;
    };

    /**
     * @description Задаем тип спикера
     * @param type
     * @public
     */
    public set type(type) {
        this._type = type;
    };

    /**
     * @description Выдаем текущий тип спикера
     * @public
     */
    public get type() {
        return this._type;
    };

    /**
     * @description
     * @param speaking
     */
    public set speaking(speaking: SpeakerType) {
        this._heartbeat.ack();

        // Если нельзя по состоянию или уже бот говорит
        if (this._type === speaking || !this.voice.websocket) return;

        // Меняем состояние спикера
        this._type = speaking;

        // Обновляем статус голоса
        this.voice.websocket.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking,
                delay: 0,
                ssrc: this.voice._attention.ssrc
            },
            seq: this.voice.websocket?.sequence ?? -1
        };
    };

    /**
     * @description Получаем ссылку на voice класс
     * @param voice
     * @public
     */
    public constructor(protected voice: VoiceConnection) {
        const heartbeat = this._heartbeat = new HeartbeatManager({
            onTimeout: () => {
                if (this.keepAlive.counter >= MAX_SIZE_VALUE) this.keepAlive.counter = 0;
                this.keepAlive.buffer.writeUInt32BE(this.keepAlive.counter++, 0);
                voice.raw_packet = this.keepAlive.buffer;

                // Отключаем спикер
                this.speaking = SpeakerType.disable;
            }
        });

        heartbeat.start(KEEP_SWITCH_SPEAKING);
    };

    /**
     * @description Уничтожаем класс спикера
     * @public
     */
    public destroy = () => {
        this._heartbeat.destroy();
        this._heartbeat = null;

        // Чистим список клиентов
        this.clients.clear();
        this.clients = null;
    };
}

/**
 * @author SNIPPIK
 * @description Тип спикера
 * @enum SpeakerType
 * @private
 */
export enum SpeakerType {
    "disable",
    "enable",
    "fake",
    "priority" = 4
}