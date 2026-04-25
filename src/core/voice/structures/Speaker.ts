import { HeartbeatManager } from "#core/voice/structures/heartbeat.js";
import { VoiceOpcodes } from "discord-api-types/voice";
import { VoiceConnection } from "#core/voice/index.js";

/**
 * @author SNIPPIK
 * @description Время через которое делается проверка speaking статус
 * @const KEEP_SWITCH_SPEAKING
 * @private
 */
const KEEP_SWITCH_SPEAKING = 10e3;

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
     * @description Менеджер жизни спикера
     * @private
     */
    private _heartbeat: HeartbeatManager;

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
        if (this._type === speaking || !this.voice.ws) return;

        // Меняем состояние спикера
        this._type = speaking;

        // Обновляем статус голоса
        this.voice.ws.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking,
                delay: 0,
                ssrc: this.voice.transport.ssrc
            },
            seq: this.voice.ws.sequence
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