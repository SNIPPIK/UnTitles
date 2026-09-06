import { type DiscordGatewayAdapterCreator, VoiceAdapter } from "./transport/adapter.js";
import { SpeakerType, VoiceSpeakerManager } from "#core/voice/structures/Speaker.js";
import { Transport, TransportStateCode } from "#core/voice/transport/index.js";
import { TypedEmitter, Logger } from "#structures";
import { db } from "#db";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /** Текущий статус голосового подключения */
    private _status: ConnectionStatus = ConnectionStatus.disconnected;

    /** Флаг полного уничтожения подключения */
    private _destroyed = false;

    /** Менеджер голосового состояния */
    private speaker: VoiceSpeakerManager | null = null;

    /** Функции для общения с websocket клиента */
    public adapter: VoiceAdapter | null = null;

    /** Транспортный класс, соединяющий в себе весь функционал */
    public transport: Transport | null = null;

    /**
     * @description Получаем текущий статус голосового подключения
     * @public
     */
    public get status() {
        return this._status;
    }

    /**
     * @description Проверяет, уничтожено ли голосовое подключение
     * @public
     */
    public get destroyed(): boolean {
        return this._destroyed;
    }

    /**
     * @description Записываем текущий статус подключения
     * @public
     */
    public set status(status: ConnectionStatus) {
        // После уничтожения состояние больше не меняем
        if (this._destroyed) return;

        // Производится попытка переподключения после уничтожения подключения
        if (this._status === null && status === ConnectionStatus.reconnecting) {
            return;
        }

        // Подключаемся к голосовому каналу
        if (status === ConnectionStatus.connecting) {
            if (this.adapter) {
                this.adapter.send(this.configuration);
                return;
            }

            throw Error("Adapter has not found");
        }

        this._status = status;
    }

    /**
     * @description Подключение к Discord по Websocket
     * @public
     */
    public get ws() {
        return this.transport?._ws ?? null;
    };

    /**
     * @description Подключение к Discord по UDP
     * @public
     */
    public get udp() {
        return this.transport?._udp ?? null;
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        return (
            !this._destroyed &&
            this._status === ConnectionStatus.connected &&
            !!this.transport?.ready
        );
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public disconnect = (): void => {
        if (this._destroyed || !this.adapter) return;

        this._status = ConnectionStatus.disconnected;
        this.configuration.channel_id = null;

        this.status = ConnectionStatus.connecting;
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set channel(ID: string) {
        if (this._destroyed || !this.adapter) return;

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
    public constructor( public configuration: VoiceConnectionConfiguration, adapterCreator: DiscordGatewayAdapterCreator) {
        super();

        this.adapter = new VoiceAdapter();
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет VOICE_SERVER_UPDATE
             */
            onVoiceServerUpdate: (packet) => {
                if (this._destroyed) return;
                if (!packet.endpoint) return;

                this.emit("info", `[Voice]: server update applied`);

                this.adapter!.packet.server = packet;

                this.transport!.state = {
                    code: TransportStateCode.OpeningWs,
                    payload: null
                };
            },

            /**
             * @description Регистрирует пакет VOICE_STATE_UPDATE
             */
            onVoiceStateUpdate: (packet) => {
                if (this._destroyed) return;

                this.emit("info", `[Voice]: client update applied`);
                this.adapter!.packet.state = packet;
            },

            /**
             * @description Регистрируем удаление данных
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
            Logger.log(
                "WARN",
                `[Voice/${this.configuration.guild_id}]: ${err}`
            );
        });

        /**
         * @description Переподключаемся
         */
        this.transport.on("reconnect", () => {
            if (this._destroyed) return;

            this.adapter?.send(this.configuration);
            this.speaker.speaking = SpeakerType.disable;
        });

        /**
         * @description Транспортный шлюз открыт
         */
        this.transport.on("open", () => {
            if (this._destroyed) return;
            this._status = ConnectionStatus.connected;
        });

        /**
         * @description Транспортный шлюз информирует
         */
        this.transport.on("info", (err) => {
            if (this._destroyed) return;

            Logger.log(
                "WARN",
                `[Voice/${this.configuration.guild_id}]: ${err}`
            );
        });

        /**
         * @description Транспортный шлюз закрывается
         */
        this.transport.on("close", (code, reason) => {
            if (this._destroyed) return;

            this.speaker.speaking = SpeakerType.disable;
            this._status = ConnectionStatus.disconnected;

            Logger.log(
                "WARN",
                `[Voice/${this.configuration.guild_id}]: ${code}: ${reason}`
            );
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
        if (this._destroyed || !this.transport || !this.speaker) {
            return;
        }

        this.speaker.speaking = this.speaker.default;

        // Если есть аудио пакеты
        if (frames) {
            this.transport.packet(frames);
        }
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        // Destroy должен быть полностью идемпотентным
        if (this._destroyed) return;

        /*
         * Сохраняем guildId до уничтожения adapter.
         */
        const guildId =
            this.adapter?.packet?.state?.guild_id ??
            this.configuration.guild_id;

        // Сразу блокируем дальнейшие callbacks / reconnect
        this._destroyed = true;
        this._status = ConnectionStatus.disconnected;

        this.emit("info", `[Voice/Cleaner] has destroyed`);

        /*
         * Удаляем соединение из глобальной БД.
         */
        if (guildId) {
            db.voice.remove(guildId);
        }

        /*
         * Если adapter ещё существует — сообщаем Discord
         * об отключении.
         *
         * Ошибка не должна препятствовать локальному cleanup.
         */
        if (this.adapter) {
            this.configuration.channel_id = null;

            try {
                this.adapter.send(this.configuration);
            } catch {
                // Adapter уже мог быть закрыт.
            }
        }

        /*
         * Освобождаем speaker.
         */
        this.speaker?.destroy?.();
        this.speaker = null;

        /*
         * Освобождаем transport.
         */
        this.transport?.destroy?.();
        this.transport = null;

        /*
         * Освобождаем adapter.
         */
        this.adapter?.destroy?.();
        this.adapter = null;

        /*
         * Больше VoiceConnection не должен удерживать
         * зарегистрированные listeners.
         */
        super.destroy();
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