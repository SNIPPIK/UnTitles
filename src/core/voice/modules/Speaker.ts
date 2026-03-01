import { HeartbeatManager } from "#core/voice/managers/heartbeat";
import { VoiceOpcodes } from "discord-api-types/voice";
import { VoiceConnection } from "#core/voice";
import {SetArray} from "#structures";

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
     * @description Список пользователей в голосовом канале, для работы E2EE
     * @public
     */
    public clients = new SetArray<string>();

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
     * @description Данные для поддержания подключения UDP
     * @private
     */
    private keepAlive = {
        /**
         * @description Буфер, используемый для записи счетчика активности
         * @readonly
         * @private
         */
        buffer: Buffer.alloc(8)
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
                ssrc: this.voice.ssrc
            },
            seq: this.voice.websocket.sequence
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
                // Если бот говорит, то не имеет смысла пинговать udp подключение
                if (this._type !== SpeakerType.disable) return;

                // Discord ожидает пакет, где в начале стоит SSRC (или просто 8 байт данных)
                // Обычно используется 8-байтовый пакет с текущим временем или SSRC
                const packet = this.keepAlive.buffer;

                // Можно записать SSRC или просто рандомное число
                packet.writeUInt32BE(this.voice.ssrc, 0);
                voice.packet(this.keepAlive.buffer, "raw");

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