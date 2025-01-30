import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData, GatewayOpcodes } from "discord-api-types/v10";
import {stateDestroyer, VoiceSocket, VoiceSocketState, VoiceSocketStatusCode} from "@service/voice";
import {Logger, TypedEmitter} from "@utils";

/**
 * @class VoiceConnection
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
    private readonly _config: VoiceConfig = {
        channelId: "0",
        guildId: "0",
        selfMute: false,
        selfDeaf: true
    };

    /**
     * @description Текущее состояние голосового подключения
     * @readonly
     * @private
     */
    private readonly _state: VoiceConnectionState;

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
    public get config() { return this._config; }

    /**
     * @description Текущее состояние голосового соединения.
     * @public
     */
    public get state() { return this._state; }

    /**
     * @description Обновляет состояние голосового соединения, выполняя операции очистки там, где это необходимо.
     * @public
     */
    public set state(newState: VoiceConnectionState) {
        const oldState = this._state;

        //Уничтожаем VoiceSocket
        stateDestroyer<VoiceSocket>(
            Reflect.get(oldState, "networking") as VoiceSocket,
            Reflect.get(newState, "networking") as VoiceSocket,
            (old) => {
                old
                    .off("error", this.onSocketError)
                    .off("close", this.onSocketClose)
                    .off("stateChange", this.onSocketStateChange)
                    .destroy();
            }
        );

        // Уничтожаем старый адаптер
        if (oldState.status !== VoiceConnectionStatus.Destroyed && newState.status === VoiceConnectionStatus.Destroyed) {
            oldState.adapter.destroy();
        }

        Object.assign(this._state, newState);

        // Меняем текущий статус
        if (oldState.status !== newState.status) {
            this.emit(newState.status as any, oldState, newState);
        }
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
     * @description Создаем класс для управления голосовым подключением
     * @param config - Данные для подключения
     * @param options - Параметры для сервера
     */
    public constructor(config: VoiceConfig, options: CreateVoiceConnectionOptions) {
        super();
        this._state = {
            status: VoiceConnectionStatus.Signalling,

            // Создаем адаптер
            adapter: options.adapterCreator({
                onVoiceServerUpdate: this.addServerPacket,
                onVoiceStateUpdate: this.addStatePacket,
                destroy: this.destroy
            })
        };

        Object.assign(this._config, config);
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
    public configureSocket = (): void => {
        const { server, state } = this._packets;

        // Если нет некоторых данных, то прекращаем выполнение
        if (!server || !state || this.state.status === VoiceConnectionStatus.Destroyed || !server.endpoint) return;

        // Создаем Socket подключение к discord
        this.state = { ...this.state,
            status: VoiceConnectionStatus.Connecting,
            networking: new VoiceSocket({
                endpoint: server.endpoint,
                serverId: server.guild_id,
                token: server.token,
                sessionId: state.session_id,
                userId: state.user_id,
            })
                .once("close", this.onSocketClose)
                .on("stateChange", this.onSocketStateChange)
                .on("error", this.onSocketError),
        };
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param buffer - Пакет Opus для воспроизведения
     * @public
     */
    public packet = (buffer: Buffer): void => {
        // Если голосовое подключение еще не готово
        if (this.state.status !== VoiceConnectionStatus.Ready) return;

        // Отправляем пакет
        this.state.networking.cryptoPacket = buffer;
    };

    /**
     * @description Отправка данных на Discord
     * @param config - Данные для подключения
     */
    public payload = (config: VoiceConfig) => {
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
     * @description Отключает голосовое соединение, предоставляя возможность повторного подключения позже.
     * @returns ``true`, если соединение было успешно отключено
     * @public
     */
    public disconnect = (): boolean => {
        if (this.state.status === VoiceConnectionStatus.Destroyed || this.state.status === VoiceConnectionStatus.Signalling) return false;

        this._config.channelId = null;

        // Отправляем в discord сообщение об отключении бота
        if (!this.state.adapter.sendPayload(this.payload(this.config))) {
            this.state = { adapter: this.state.adapter, status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.AdapterUnavailable };
            return false;
        }

        // Меняем статус на VoiceConnectionStatus.Disconnected
        this.state = { adapter: this.state.adapter, reason: VoiceConnectionDisconnectReason.Manual, status: VoiceConnectionStatus.Disconnected };
        return true;
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
    public rejoin = (joinConfig?: VoiceConfig): boolean => {
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
     * @readonly
     * @private
     */
    private readonly onSocketClose = (code: number): void => {
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
     * @readonly
     * @private
     */
    private readonly onSocketStateChange = (oldState: VoiceSocketState, newState: VoiceSocketState): void => {
        const state = this.state;

        if (oldState.code === newState.code || state.status !== VoiceConnectionStatus.Connecting && state.status !== VoiceConnectionStatus.Ready) return;
        if (newState.code === VoiceSocketStatusCode.ready) this.state = { ...state, status: VoiceConnectionStatus.Ready };
        else if (newState.code !== VoiceSocketStatusCode.close) this.state = { ...state, status: VoiceConnectionStatus.Connecting };
    };

    /**
     * @description Распространяет ошибки из базового сетевого экземпляра.
     * @param error - Распространяемая ошибка
     * @readonly
     * @private
     */
    private readonly onSocketError = (error: Error): void => {
        this.emit("error", error);
    };

    /**
     * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
     * новых данных, предоставленных в пакете.
     * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
     * @readonly
     * @private
     */
    private readonly addServerPacket = (packet: GatewayVoiceServerUpdateDispatchData): void => {
        const state = this.state;

        this._packets.server = packet;

        if (packet.endpoint) this.configureSocket();
        else if (state.status !== VoiceConnectionStatus.Destroyed) {
            this.state = { ...state, status: VoiceConnectionStatus.Disconnected, reason: VoiceConnectionDisconnectReason.EndpointRemoved };
        }
    };

    /**
     * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
     * канала, к которому подключен клиент.
     * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
     * @readonly
     * @private
     */
    private readonly addStatePacket = (packet: GatewayVoiceStateUpdateDispatchData): void => {
        this._packets.state = packet;
        Object.assign(this._config, packet);
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
 * @class VoiceConnection
 * @description События для VoiceConnection
 */
interface VoiceConnectionEvents {
    "connecting": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this | void;
    "destroyed": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this | void;
    "disconnected": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this | void;
    "ready": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this | void;
    "signalling": (oldState: VoiceConnectionState, newState: VoiceConnectionState & { status: Event }) => this | void;

    "error": (error: Error) => this;
    "debug": (message: string) => this;
    "stateChange": (oldState: VoiceConnectionState, newState: VoiceConnectionState) => this;
}

/**
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
 * Состояние, в котором будет находиться голосовое соединение, когда оно ожидает получения пакетов VOICE_SERVER_UPDATE и
 * VOICE_STATE_UPDATE от Discord, предоставляемых адаптером.
 */
interface VoiceConnectionSignallingState {
    adapter: DiscordGatewayAdapterImplementerMethods;
    status: VoiceConnectionStatus.Signalling;
}

/**
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
 * @description Различные состояния, в которых может находиться голосовое соединение.
 */
type VoiceConnectionState = | VoiceStateConnecting | VoiceStateDestroyed | VoiceConnectionDisconnectedOtherState | VoiceConnectionDisconnectedWebSocketState | VoiceStateReady | VoiceConnectionSignallingState;

/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
 * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
interface VoiceConnectionDisconnectedBaseState {
    adapter: DiscordGatewayAdapterImplementerMethods;
    status: VoiceConnectionStatus.Disconnected;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда оно не подключено к голосовому серверу Discord и не
 * пытается подключиться. Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
interface VoiceConnectionDisconnectedOtherState extends VoiceConnectionDisconnectedBaseState {
    reason: Exclude<VoiceConnectionDisconnectReason, VoiceConnectionDisconnectReason.WebSocketClose>;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, когда его подключение к WebSocket было закрыто.
 * Вы можете вручную попытаться повторно подключиться, используя голосовое соединение#reconnect.
 */
interface VoiceConnectionDisconnectedWebSocketState extends VoiceConnectionDisconnectedBaseState {
    closeCode: number;
    reason: VoiceConnectionDisconnectReason.WebSocketClose;
}

/**
 * @description The state that a VoiceConnection will be in when it is establishing a connection to a Discord
 * voice server.
 */
interface VoiceStateConnecting {
    adapter: DiscordGatewayAdapterImplementerMethods;
    networking: VoiceSocket;
    status: VoiceConnectionStatus.Connecting;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение при активном подключении к
 * голосовому серверу Discord.
 */
interface VoiceStateReady {
    adapter: DiscordGatewayAdapterImplementerMethods;
    networking: VoiceSocket;
    status: VoiceConnectionStatus.Ready;
}

/**
 * @description Состояние, в котором будет находиться голосовое соединение, если оно было безвозвратно уничтожено
 * пользователем и не отслежено библиотекой. Его невозможно повторно подключить, вместо
 * этого необходимо установить новое голосовое соединение.
 */
interface VoiceStateDestroyed {
    status: VoiceConnectionStatus.Destroyed;
}

/**
 * @description Параметры, которые могут быть заданы при создании голосового соединения.
 */
interface CreateVoiceConnectionOptions {
    adapterCreator: DiscordGatewayAdapterCreator;

    /**
     * If true, debug messages will be enabled for the voice connection and its
     * related components. Defaults to false.
     */
    debug?: boolean | undefined;
}

/**
 * @description Конфиг для подключения к голосовому каналу
 */
export interface VoiceConfig {
    channelId: string | null;
    guildId: string;
    selfDeaf: boolean;
    selfMute: boolean;
}

/**
 * @description Шлюз Discord Адаптер, шлюза Discord.
 */
export interface DiscordGatewayAdapterLibraryMethods {
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
export interface DiscordGatewayAdapterImplementerMethods {
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
export type DiscordGatewayAdapterCreator = ( methods: DiscordGatewayAdapterLibraryMethods) => DiscordGatewayAdapterImplementerMethods;