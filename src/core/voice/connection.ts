import { type DiscordGatewayAdapterCreator, VoiceAdapter } from "./transport/adapter.js";
import { SpeakerType, VoiceSpeakerManager } from "#core/voice/structures/Speaker.js";
import {Transport, TransportStateCode} from "#core/voice/transport/index.js";
import { TypedEmitter, Logger } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /** Текущий статус голосового подключения */
    private _status: ConnectionStatus = ConnectionStatus.disconnected;

    /** Менеджер голосового состояния */
    private speaker: VoiceSpeakerManager | null = null;

    /** Функции для общения с websocket клиента */
    public adapter: VoiceAdapter | null = null;

    /** Транспортный класс, соединяющий в себе весь функционал */
    public transport: Transport = null;

    /**
     * @description Получаем текущий статус голосового подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Записываем текущий статус подключения
     * @public
     */
    public set status(status: ConnectionStatus) {
        // Производится попытка переподключения после уничтожения подключения
        if (this._status === null && status === ConnectionStatus.reconnecting) {
            return;
        }

        // Подключаемся к голосовому каналу
        if (status === ConnectionStatus.connecting) {
            // Инициализируем подключение
            if (this.adapter) {
                // Подключаемся
                this.adapter.send(this.configuration);
                return;
            }

            // Если не удалось найти адаптер
            throw Error("Adapter has not found");
        }

        this._status = status;
    }

    /**
     * @description Подключение к Discord по Websocket
     * @public
     */
    public get ws() {
        return this.transport._ws;
    };

    /**
     * @description Подключение к Discord по UDP
     * @public
     */
    public get udp() {
        return this.transport._udp;
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        return this._status === ConnectionStatus.connected && this.transport.ready;
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public disconnect = (): void => {
        // Если нет адаптера
        if (!this.adapter) return;

        this.status = ConnectionStatus.disconnected;
        this.configuration.channel_id = null; // Удаляем id канала

        // Отправляем в discord сообщение об отключении бота
        this.status = ConnectionStatus.connecting;
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set channel(ID: string) {
        // Если нет адаптера
        if (!this.adapter) return;

        // Прописываем новый id канала
        this.configuration.channel_id = ID;
        this.status = ConnectionStatus.connecting;
    };

    /**
     * @description Создаем голосовое подключение
     * @param configuration - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     * @constructor
     * @public
     */
    public constructor(public configuration: VoiceConnectionConfiguration, adapterCreator: DiscordGatewayAdapterCreator) {
        super();
        this.adapter = new VoiceAdapter();
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet) => {
                // Если ссылки для подключения нет
                if (!packet.endpoint) return;

                this.emit("info", `[Voice]: server update applied`);
                this.adapter.packet.server = packet;

                // Отправляем статус
                this.transport.state = {
                    code: TransportStateCode.OpeningWs,
                    payload: null
                }
            },

            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             */
            onVoiceStateUpdate: (packet) => {
                this.emit("info", `[Voice]: client update applied`);
                this.adapter.packet.state = packet;
            },

            /**
             * @description Регистрируем удаление данных из класса голосового подключения
             */
            destroy: this.destroy
        });

        // Создаем транспортный шлюз
        this.transport = new Transport(this.adapter);
        this.speaker = new VoiceSpeakerManager(this);

        // Задаем статус подключения
        this.status = ConnectionStatus.connecting;

        /**
         * @description Слушаем данные VoiceConnection
         */
        this.on("info", (err) => {
            Logger.log("WARN",`[Voice/${this.configuration.guild_id}]: ${err}`);
        });

        /**
         * @description Переподключаемся
         */
        this.transport.on("reconnect", (_) => {
            this.adapter.send(this.configuration);
        });

        /**
         * @description Транспортный шлюз открыт
         */
        this.transport.on("open", () => {
            this._status = ConnectionStatus.connected;
        });

        /**
         * @description Транспортный шлюз информирует
         */
        this.transport.on("info", (err) => {
            Logger.log("WARN",`[Voice/${this.configuration.guild_id}]: ${err}`);
        });

        /**
         * @description Транспортный шлюз закрывается
         */
        this.transport.on("close", (code, reason) => {
            this._status = ConnectionStatus.disconnected;
            Logger.log("WARN",`[Voice/${this.configuration.guild_id}]: ${code}: ${reason}`);
        });

        /**
         * @description Транспортный шлюз полностью закрывается
         */
        this.transport.once("destroyed", this.destroy);
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param frames - Аудио пакет OPUS
     * @public
     */
    public packet = (frames: Buffer[]) => {
        this.speaker.speaking = this.speaker.default;
        if (frames) this.transport.packet(frames);
    };

    /**
     * @description Удаление голосового соединения без отключения от голосового канала
     * @protected
     */
    protected silent_destroy = () => {
        if (this._status === ConnectionStatus.disconnected) return;

        this._status = ConnectionStatus.disconnected;

        this.speaker?.destroy?.();
        this.speaker = null;

        this.transport?.destroy?.();
        this.transport = null;

        this.adapter?.destroy?.();
        this.adapter = null;
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        if (this._status === ConnectionStatus.disconnected || !this.adapter) return;
        this.emit("info", `[Voice/Cleaner] has destroyed`);
        this.disconnect();
        this.silent_destroy();

        // Удаляем информацию о сессии из глобальной/импортируемой БД
        if (this.adapter.packet?.state?.guild_id) {
            db.voice.remove(this.adapter.packet.state.guild_id);
        }
    };
}

/**
 * @author SNIPPIK
 * @description События голосового подключения
 * @interface VoiceConnectionEvents
 * @private
 */
interface VoiceConnectionEvents {
    /** Событие получения лога от голосового канала */
    readonly "info": (status: string | Error) => void;
}


/**
 * @author SNIPPIK
 * @description Статусы подключения голосового соединения
 * @enum ConnectionStatus
 * @private
 */
enum ConnectionStatus {
    /** Статус при котором голосовое подключение отключено */
    disconnected = "disconnected",

    /** Статус при котором производится переподключение*/
    reconnecting = "reconnecting",

    /** Статус при котором голосовое соединение начало соединение (WS, UDP, RTP, DAVE и тп) */
    connecting = "connecting",

    /** Статус при котором голосовое соединение с каналом установлено (WS, UDP, RTP, DAVE и тп) */
    connected = "connected"
}

/**
 * @author SNIPPIK
 * @description Параметры для создания голосового соединения
 * @interface VoiceConnectionConfiguration
 * @public
 */
export interface VoiceConnectionConfiguration {
    /** Идентификатор гильдии */
    guild_id?:    string;

    /** Идентификатор канала */
    channel_id:   string;

    /** Отключен ли звук */
    self_deaf:    boolean;

    /** Приглушен ли бот (отключен микрофон/спикер) */
    self_mute:    boolean;

    /** Тип спикера, для отправки аудио пакетов в голосовой канал */
    self_speaker?: SpeakerType;
}