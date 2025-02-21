import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData, GatewayOpcodes } from "discord-api-types/v10";
import {VoiceSocket, VoiceSocketState, VoiceSocketStatusCode} from "@service/voice";
import {Logger, TypedEmitter} from "@utils";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу Гильдии может использоваться для воспроизведения аудио в голосовых каналах.
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /**
     * @description Конфигурация голосового подключения
     * @readonly
     * @private
     */
    private readonly _config: {
        channelId: string | null;
        guildId: string;
        selfDeaf: boolean;
        selfMute: boolean;
    } = null;

    /**
     * @description Текущее состояние голосового подключения
     * @readonly
     * @private
     */
    private readonly _state: ConnectionState.State = null;

    /**
     * @description Пакеты для работы с голосовым подключением
     * @readonly
     * @private
     */
    private readonly _packets = {
        /**
         * @description Пакет состояния на сервере
         * @private
         */
        server: undefined as GatewayVoiceServerUpdateDispatchData,

        /**
         * @description Пакет текущего состояния
         * @private
         */
        state: undefined  as GatewayVoiceStateUpdateDispatchData
    };

    /**
     * @description Текущий VoiceConfig
     * @public
     */
    public get config() {
        return this._config;
    };

    /**
     * @description Текущее состояние голосового соединения.
     * @public
     */
    public get state() {
        return this._state;
    };

    /**
     * @description Обновляет состояние голосового соединения, выполняя операции очистки там, где это необходимо.
     * @public
     */
    public set state(newState: ConnectionState.State) {
        const oldState = this._state;

        // Уничтожаем прошлый VoiceSocket
        if (oldState && "networking" in oldState && oldState.networking !== newState["networking"]) {
            try {
                oldState.networking
                    .off("error", this.onSocketError)
                    .off("close", this.onSocketClose)
                    .off("stateChange", this.onSocketStateChange)
                    .destroy();
            } catch {
                // Возможно что VoiceSocket уже уничтожен
                oldState.networking.destroy();
            }
        }

        // Уничтожаем старый адаптер
        if (oldState.status !== VoiceConnectionStatus.Destroyed && newState.status === VoiceConnectionStatus.Destroyed) {
            oldState.adapter.destroy();
        }

        // Меняем текущий статус
        if (oldState.status !== newState.status) this.emit(newState.status as any, oldState, newState);
        Object.assign(this._state, newState);
    };

    /**
     * @description Обновляет статус голосового соединения. Используется, когда аудио плееры завершили воспроизведение звука
     * и необходимо подать сигнал о том, что соединение больше не воспроизводит звук.
     * @param enabled - Показывать или не показывать, как говорящий
     * @public
     */
    public set speak(enabled: boolean) {
        // Если голосовое подключение еще не готово
        if (this.state.status !== VoiceConnectionStatus.Ready) return;

        // Меняем параметр голоса на указанный
        this.state.networking.speaking = enabled;
    };

    /**
     * @description Отключает голосовое соединение, предоставляя возможность повторного подключения позже.
     * @returns ``true`, если соединение было успешно отключено
     * @public
     */
    public get disconnect (): boolean {
        if (this.state.status === VoiceConnectionStatus.Destroyed || this.state.status === VoiceConnectionStatus.Signalling) return false;

        this._config.channelId = null;

        // Отправляем в discord сообщение об отключении бота
        if (!this.state.adapter.sendPayload(this.payload(this.config))) {
            this.state = {
                reason: VoiceConnectionDisconnectReason.AdapterUnavailable,
                status: VoiceConnectionStatus.Disconnected,
                adapter: this.state.adapter
            };
            return false;
        }

        // Меняем статус на VoiceConnectionStatus.Disconnected
        this.state = {
            reason: VoiceConnectionDisconnectReason.Manual,
            status: VoiceConnectionStatus.Disconnected,
            adapter: this.state.adapter
        };
        return true;
    };

    /**
     * @description Пытается настроить сетевой экземпляр для этого голосового соединения, используя полученные пакеты.
     * Требуются оба пакета, и любой существующий сетевой экземпляр будет уничтожен.
     *
     * @remarks
     * Это вызывается при изменении голосового сервера подключения, например, если бот перемещен на
     * другой канал в той же гильдии, но имеет другой голосовой сервер. В этом случае
     * необходимо повторно установить соединение с новым голосовым сервером.
     *
     * Соединение перейдет в состояние подключения, когда это будет вызвано.
     * @public
     */
    public get configureSocket() {
        const { server, state } = this._packets;

        // Если нет некоторых данных, то прекращаем выполнение
        if (!server || !state || this.state.status === VoiceConnectionStatus.Destroyed || !server.endpoint) return false;

        // Создаем Socket подключение к discord
        this.state = { ...this.state,
            status: VoiceConnectionStatus.Connecting,
            networking: new VoiceSocket({
                sessionId: state.session_id,
                endpoint: server.endpoint,
                serverId: server.guild_id,
                userId: state.user_id,
                token: server.token
            })
                .once("close", this.onSocketClose)
                .on("stateChange", this.onSocketStateChange)
                .on("error", this.onSocketError),
        };
        return true;
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param buffer - Пакет Opus для воспроизведения
     * @public
     */
    public set packet(buffer: Buffer) {
        // Если голосовое подключение еще не готово
        if (this.state.status !== VoiceConnectionStatus.Ready) return;

        // Отправляем пакет
        this.state.networking.cryptoPacket = buffer;
    };

    /**
     * @description Создаем класс для управления голосовым подключением
     * @param config - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     */
    public constructor(config: VoiceConnection["config"], adapterCreator: DiscordGatewayAdapter.Creator) {
        super();
        this._state = {
            status: VoiceConnectionStatus.Signalling,

            // Создаем адаптер
            adapter: adapterCreator({
                /**
                 * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
                 * новых данных, предоставленных в пакете.
                 * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
                 */
                onVoiceServerUpdate: (packet: GatewayVoiceServerUpdateDispatchData): void => {
                    const state = this.state;

                    this._packets.server = packet;

                    if (packet.endpoint) this.configureSocket;
                    else if (state.status !== VoiceConnectionStatus.Destroyed) this.state = {
                        ...state,
                        reason: VoiceConnectionDisconnectReason.EndpointRemoved,
                        status: VoiceConnectionStatus.Disconnected
                    };
                },

                /**
                 * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
                 * канала, к которому подключен клиент.
                 * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
                 * @private
                 */
                onVoiceStateUpdate: (packet: GatewayVoiceStateUpdateDispatchData): void => {
                    this._packets.state = packet;
                    Object.assign(this._config, packet);
                },
                destroy: this.destroy
            })
        };

        this._config = config;
    };

    /**
     * @description Отправка данных на Discord
     * @param config - Данные для подключения
     */
    public payload = (config: VoiceConnection["config"]) => {
        return {
            op: GatewayOpcodes.VoiceStateUpdate,
            d: {
                guild_id: config.guildId,
                channel_id: config.channelId,
                self_deaf: config.selfDeaf,
                self_mute: config.selfMute
            }
        }
    };

    /**
     * @description Переподключение к текущему каналу или новому голосовому каналу
     *
     * @remarks
     * Успешный вызов этого метода автоматически увеличит счетчик попыток повторного подключения,
     * который вы можете использовать, чтобы сообщить, хотите ли вы продолжать попытки повторного подключения
     * к голосовому соединению.
     *
     * При вызове этого параметра будет наблюдаться переход состояния из отключенного в сигнализирующее.

     * @param joinConfig - Данные канала для переподключения
     * @returns ``true`, если соединение было успешно установлено
     * @public
     */
    public rejoin = (joinConfig?: VoiceConnection["config"]): boolean => {
        const state = this.state;

        // Если статус не дает переподключиться
        if (state.status === VoiceConnectionStatus.Destroyed) return false;

        // Если еще можно переподключиться
        if (state.adapter.sendPayload(this.payload(this.config))) {
            if (this.state.status !== VoiceConnectionStatus.Ready) this.state = { ...state, status: VoiceConnectionStatus.Signalling };
            return true;
        }

        // Если надо создать новое голосовое подключение
        this.state = {
            adapter: state.adapter,
            status: VoiceConnectionStatus.Disconnected,
            reason: VoiceConnectionDisconnectReason.AdapterUnavailable
        };

        // Обновляем конфиг
        Object.assign(this._config, joinConfig);
        return false;
    };

    /**
     * @description Вызывается, когда сетевой экземпляр для этого соединения закрывается. Если код закрытия равен 4014 (не подключаться повторно),
     * голосовое соединение перейдет в отключенное состояние, в котором будет сохранен код закрытия. Вы можете
     * решить, следует ли повторно подключаться, когда это произойдет, прослушав изменение состояния и вызвав функцию reconnect().
     *
     * @remarks
     * Если код закрытия был иным, чем 4014, вполне вероятно, что закрытие не было запланировано, и поэтому
     * голосовое соединение подаст Discord сигнал о том, что оно хотело бы вернуться к каналу. При этом автоматически будет предпринята попытка
     * восстановить соединение. Это можно было бы рассматривать как переход из состояния готовности в состояние сигнализации.
     * @param code - Код закрытия
     * @private
     */
    private onSocketClose = (code: number): void => {
        const state = this.state;

        // Если голосовое подключение уже уничтожено
        if (state.status === VoiceConnectionStatus.Destroyed) return;

        // Если подключение к сети завершится, пробуем снова подключиться к голосовому каналу.
        if (code === 4_014) {
            // Отключен - сеть здесь уже разрушена
            this.state = { ...state, closeCode: code,
                status: VoiceConnectionStatus.Disconnected,
                reason: VoiceConnectionDisconnectReason.WebSocketClose
            };
        } else {
            this.state = { ...state, status: VoiceConnectionStatus.Signalling };

            if (!state.adapter.sendPayload(this.payload(this.config))) this.state = {
                ...state, status: VoiceConnectionStatus.Disconnected,
                reason: VoiceConnectionDisconnectReason.AdapterUnavailable
            };
        }
    };

    /**
     * @description Вызывается при изменении состояния сетевого экземпляра. Используется для определения состояния голосового соединения.
     * @param oldState - Предыдущее состояние
     * @param newState - Новое состояние
     * @private
     */
    private onSocketStateChange = (oldState: VoiceSocketState.States, newState: VoiceSocketState.States): void => {
        const state = this.state;

        if (oldState.code === newState.code || state.status !== VoiceConnectionStatus.Connecting && state.status !== VoiceConnectionStatus.Ready) return;

        if (newState.code === VoiceSocketStatusCode.ready) this.state = { ...state, status: VoiceConnectionStatus.Ready };
        else if (newState.code !== VoiceSocketStatusCode.close) this.state = { ...state, status: VoiceConnectionStatus.Connecting };
    };

    /**
     * @description Распространяет ошибки из базового сетевого экземпляра.
     * @param error - Распространяемая ошибка
     * @private
     */
    private onSocketError = (error: Error): void => {
        this.emit("error", error);
    };

    /**
     * Разрушает голосовое соединение, предотвращая повторное подключение к голосовой связи.
     * Этот метод следует вызывать, когда голосовое соединение вам больше не требуется, чтобы
     * предотвратить утечку памяти
     * @param adapterAvailable - Можно ли использовать адаптер
     * @public
     */
    public destroy = (adapterAvailable = false): void => {
        const state = this.state;

        // Если подключение уже уничтожено
        if (state.status === VoiceConnectionStatus.Destroyed) return;
        if (adapterAvailable) state.adapter.sendPayload(this.payload({...this.config, channelId: null}));

        this.state = { status: VoiceConnectionStatus.Destroyed };

        // DEBUG
        Logger.log("DEBUG", `[VoiceConnection] has destroyed`);
    };
}

/**
 * @author SNIPPIK
 * @description События для VoiceConnection
 * @interface VoiceConnection
 */
interface VoiceConnectionEvents {
    "stateChange": (oldState: ConnectionState.State, newState: ConnectionState.State) => this;
    "connecting": (oldState: ConnectionState.State, newState: ConnectionState.State & { status: Event }) => this | void;
    "destroyed": (oldState: ConnectionState.State, newState: ConnectionState.State & { status: Event }) => this | void;
    "disconnected": (oldState: ConnectionState.State, newState: ConnectionState.State & { status: Event }) => this | void;
    "ready": (oldState: ConnectionState.State, newState: ConnectionState.State & { status: Event }) => this | void;
    "signalling": (oldState: ConnectionState.State, newState: ConnectionState.State & { status: Event }) => this | void;

    "error": (error: Error) => this;
    "debug": (message: string) => this;
}

/**
 * @author SNIPPIK
 * @description Различные коды состояния, которые может содержать голосовое соединение в любой момент времени.
 */
export enum VoiceConnectionStatus {
    /**
     * @description Пакеты `VOICE_SERVER_UPDATE` и `VOICE_STATE_UPDATE` были получены, теперь предпринимается попытка установить голосовое соединение.
     */
    Connecting = "connecting",

    /**
     * @description Голосовое соединение было разрушено и не отслеживалось, его нельзя использовать повторно.
     */
    Destroyed = "destroyed",

    /**
     * @description Голосовое соединение либо разорвано, либо не установлено.
     */
    Disconnected = "disconnected",

    /**
     * @description Голосовое соединение установлено и готово к использованию.
     */
    Ready = "ready",

    /**
     * @description Отправляем пакет на главный шлюз Discord, чтобы указать, что мы хотим изменить наше голосовое состояние.
     */
    Signalling = "signalling",
}

/**
 * @author SNIPPIK
 * @description Причины, по которым голосовое соединение может находиться в отключенном состоянии.
 */
enum VoiceConnectionDisconnectReason {
    /**
     * @description Когда соединение с WebSocket было закрыто.
     */
    WebSocketClose,

    /**
     * @description Когда адаптеру не удалось отправить сообщение, запрошенное голосовым соединением.
     */
    AdapterUnavailable,

    /**
     * @description Когда получен пакет VOICE_SERVER_UPDATE с нулевой конечной точкой, что приводит к разрыву соединения.
     */
    EndpointRemoved,

    /**
     * @description Когда было запрошено ручное отключение.
     */
    Manual,
}

/**
 * @author SNIPPIK
 * @description Все состояния голосового подключения
 * @namespace ConnectionState
 */
namespace ConnectionState {
    export type State = Connecting | Ready | Disconnected | Destroyed | Signalling | DisconnectedWebSocket;

    /**
     * @description The state that a VoiceConnection will be in when it is establishing a connection to a Discord
     * voice server.
     */
    interface Connecting {
        adapter: DiscordGatewayAdapter.ImplementerMethods;
        networking: VoiceSocket;
        status: VoiceConnectionStatus.Connecting;
    }

    /**
     * @description Состояние, в котором будет находиться голосовое соединение при активном подключении к
     * голосовому серверу Discord.
     */
    interface Ready {
        adapter: DiscordGatewayAdapter.ImplementerMethods;
        networking: VoiceSocket;
        status: VoiceConnectionStatus.Ready;
    }

    /**
     * @description Состояние, в котором будет находиться голосовое соединение, если оно было безвозвратно уничтожено
     * пользователем и не отслежено библиотекой. Его невозможно повторно подключить, вместо
     * этого необходимо установить новое голосовое соединение.
     */
    interface Destroyed {
        status: VoiceConnectionStatus.Destroyed;
    }

    /**
     * Состояние, в котором будет находиться голосовое соединение, когда оно ожидает получения пакетов VOICE_SERVER_UPDATE и
     * VOICE_STATE_UPDATE от Discord, предоставляемых адаптером.
     */
    interface Signalling {
        adapter: DiscordGatewayAdapter.ImplementerMethods;
        status: VoiceConnectionStatus.Signalling;
    }

    /**
     * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
     * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
     */
    interface Disconnected extends Disconnected_Base {
        reason: Exclude<VoiceConnectionDisconnectReason, VoiceConnectionDisconnectReason.WebSocketClose>;
    }

    /**
     * @description Состояние, в котором будет находиться голосовое соединение, когда его подключение к WebSocket было закрыто.
     * Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
     */
    interface DisconnectedWebSocket extends Disconnected_Base {
        closeCode: number;
        reason: VoiceConnectionDisconnectReason.WebSocketClose;
    }

    /**
     * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
     * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
     */
    interface Disconnected_Base {
        adapter: DiscordGatewayAdapter.ImplementerMethods;
        status: VoiceConnectionStatus.Disconnected;
    }
}

/**
 * @author SNIPPIK
 * @description Параметры для создания адаптера
 * @namespace DiscordGatewayAdapter
 */
export namespace DiscordGatewayAdapter {
    /**
     * @description Шлюз Discord Адаптер, шлюза Discord.
     */
    export interface LibraryMethods {
        /**
         * Call this when the adapter can no longer be used (e.g. due to a disconnect from the main gateway)
         */
        destroy(): void;
        /**
         * Call this when you receive a VOICE_SERVER_UPDATE payload that is relevant to the adapter.
         *
         * @param data - The inner data of the VOICE_SERVER_UPDATE payload
         */
        onVoiceServerUpdate(data: GatewayVoiceServerUpdateDispatchData): void;
        /**
         * Call this when you receive a VOICE_STATE_UPDATE payload that is relevant to the adapter.
         *
         * @param data - The inner data of the VOICE_STATE_UPDATE payload
         */
        onVoiceStateUpdate(data: GatewayVoiceStateUpdateDispatchData): void;
    }

    /**
     * @description Методы, предоставляемые разработчиком адаптера Discord Gateway для DiscordGatewayAdapter.
     */
    export interface ImplementerMethods {
        /**
         * @description Это будет вызвано voice, когда адаптер можно будет безопасно уничтожить, поскольку он больше не будет использоваться.
         */
        destroy(): void;
        /**
         * @description Реализуйте этот метод таким образом, чтобы данная полезная нагрузка отправлялась на основное соединение Discord gateway.
         *
         * @param payload - Полезная нагрузка для отправки на основное соединение Discord gateway
         * @returns `false`, если полезная нагрузка определенно не была отправлена - в этом случае голосовое соединение отключается
         */
        sendPayload(payload: any): boolean;
    }

    /**
     * Функция, используемая для создания адаптеров. Она принимает параметр methods, содержащий функции, которые
     * могут быть вызваны разработчиком при получении новых данных по его шлюзовому соединению. В свою очередь,
     * разработчик вернет некоторые методы, которые может вызывать библиотека - например, для отправки сообщений на
     * шлюз или для подачи сигнала о том, что адаптер может быть удален.
     */
    export type Creator = ( methods: LibraryMethods) => ImplementerMethods;
}