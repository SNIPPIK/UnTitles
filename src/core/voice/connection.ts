import { type DiscordGatewayAdapterCreator, VoiceAdapter } from "./transport/adapter.js";
import { SpeakerType, VoiceSpeakerManager } from "#core/voice/structures/Speaker.js";
import { Transport } from "#core/voice/transport/index.js";
import { TypedEmitter, Logger } from "#structures";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /** Текущий статус подключения */
    private _status: ConnectionStatus = ConnectionStatus.disconnected;

    /** Менеджер спикера */
    private speaker: VoiceSpeakerManager | null = new VoiceSpeakerManager(this);

    /** Функции для общения с websocket клиента */
    public adapter: VoiceAdapter | null = new VoiceAdapter();

    /** Транспортный класс, соединяющий в себе весь функционал */
    public transport: Transport = null;

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Записываем текущий статус подключения
     * @public
     */
    public set status(status) {
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
    };

    /**
     * @description WebSocket подключение к discord
     * @public
     */
    public get ws() {
        return this.transport._ws;
    };

    /**
     * @description UDP подключение к discord
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
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet) => {
                this.adapter.packet.server = packet;

                // Если есть точка подключения
                if (packet.endpoint) {
                    this.transport.connect(packet.endpoint);
                    this.status = ConnectionStatus.connected;
                    this.emit("info", `[Voice/Adapter]: receive on onVoiceServerUpdate`);
                }
            },

            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             */
            onVoiceStateUpdate: (packet) => {
                this.adapter.packet.state = packet;
                this.emit("info", `[Voice/Adapter]: receive on onVoiceStateUpdate`);
            },

            /**
             * @description Регистрируем удаление данных из класса голосового подключения
             */
            destroy: this.destroy
        });

        // Создаем транспортный шлюз
        this.transport = new Transport(this.adapter);

        // Задаем статус подключения
        this.status = ConnectionStatus.connecting;

        // Слушаем если шлюзу пытается выключиться по какой причине
        this.on("info", (err) => {
            Logger.log("WARN",`[Voice Layer/${this.configuration.guild_id}]: ${err}`);
        });

        // Слушаем если шлюзу пытается выключиться по какой причине
        this.transport.on("info", (err) => {
            Logger.log("WARN",`[Voice Layer/${this.configuration.guild_id}]: ${err}`);
        });

        this.transport.on("close", (code, reason) => {
            Logger.log("WARN",`[Voice Layer/${this.configuration.guild_id}]: ${code}: ${reason}`);
        });
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param frames - Аудио пакет OPUS
     * @public
     */
    public packet = (frames: Buffer[] | Buffer) => {
        this.speaker.speaking = this.speaker.default;
        if (frames) this.transport.packet(frames);
        return;
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        this.emit("info", `[Voice/Cleaner] has destroyed`);

        if (this._status === ConnectionStatus.disconnected) return;
        this.status = ConnectionStatus.disconnected;
        this.speaker.destroy();

        // Очищаем адаптер последним
        this.adapter.destroy();

        // Nullify
        this.adapter = null;
        this.speaker = null;
        this._status = null;
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

    /** Событие подключения к голосовому каналу */
    readonly "connect": () => void;

    /** Событие отключения от голосового канала */
    readonly "disconnect": () => void;
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

    /** Будет ли бот транслировать с помощью "Go Live" */
    self_stream?: boolean;

    /** Тип спикера, для отправки аудио пакетов в голосовой канал */
    self_speaker?: SpeakerType;
}