import {GatewayOpcodes, GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData} from "discord-api-types/v10";
import {DiscordGatewayAdapterCreator, DiscordGatewayAdapterImplementerMethods} from "@structures/discord/modules/VoiceManager";
import {VoiceConnectionStatus, VoiceSocket, VoiceSocketState, VoiceSocketStatusCode} from "@service/voice";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection {
    /**
     * @description Конфигурация голосового подключения
     * @private
     */
    private configuration: VoiceConnectionConfig = null;

    /**
     * @description Текущее состояние голосового подключения
     * @private
     */
    private state = {
        status: VoiceConnectionStatus.Signalling as VoiceConnectionStatus,
        socket: null as VoiceSocket
    };

    /**
     * @description Функции для общения с websocket клиента
     * @public
     */
    public adapter: VoiceAdapter = new VoiceAdapter();

    /**
     * @description Текущая конфигурация голосового подключения
     * @public
     */
    public get config() {
        return this.configuration;
    };

    /**
     * @description Изменяем данные о подключении WebSocket и UDPSocket
     * @public
     */
    public set network(socket: VoiceSocket) {
        // Если есть прошлое соединение
        if (this.state.socket) {
            this.state.socket.off("close", this.VoiceSocketClose);
            this.state.socket.off("stateChange", this.VoiceSocketStateChange);

            // Уничтожаем старое подключение
            this.state.socket.destroy();
        }

        // Если подключение не уничтожилось
        if (this.state.status !== VoiceConnectionStatus.Destroyed) {
            socket
                .once("close", this.VoiceSocketClose)
                .on("stateChange", this.VoiceSocketStateChange);

            // Создаем новое подключение
            this.state.socket = socket;
        }
    };

    /**
     * @description Текущее состояние голосового подключения
     * @public
     */
    public get status() {
        return this.state.status;
    };

    /**
     * @description Меняем состояние статуса
     * @param status - Статус
     */
    public set status(status) {
        // Уничтожаем старый адаптер
        if (this.state.status !== VoiceConnectionStatus.Destroyed && status === VoiceConnectionStatus.Destroyed) {
            this.adapter.adapter.destroy();
        }

        // Если уже установлен такой статус
        else if (status === this.state.status) return;

        // Меняем статус
        this.state.status = status;
    };



    /**
     * @description Изменение состояния спикера
     * @public
     */
    public set speak(enabled: boolean) {
        // Если голосовое подключение еще не готово
        if (this.state.status !== VoiceConnectionStatus.Ready) return;

        // Меняем параметр голоса на указанный
        this.state.socket.speaking = enabled;
    };

    /**
     * @description Отключает голосовое соединение, предоставляя возможность повторного подключения позже.
     * @returns ``true`, если соединение было успешно отключено
     * @public
     */
    public get disconnect () {
        if (this.state.status === VoiceConnectionStatus.Destroyed || this.state.status === VoiceConnectionStatus.Signalling) return false;
        this.configuration.channel_id = null;

        // Отправляем в discord сообщение об отключении бота
        if (!this.adapter.sendPayload(this.config)) {
            this.status = VoiceConnectionStatus.Disconnected;
            return false;
        }

        // Меняем статус на Disconnected
        this.status = VoiceConnectionStatus.Disconnected;
        return true;
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param packet - Пакет Opus для воспроизведения
     * @public
     */
    public set packet(packet: Buffer) {
        // Если голосовое подключение еще не готово
        if (this.state.status === VoiceConnectionStatus.Ready) {
            // Отправляем пакет, если его нет то будет отправлена пустышка.
            // Пустышка требуется для не нарушения работы интерполятора opus.
            if (packet) this.state.socket.cryptoPacket = packet;
        }
    };

    /**
     * @description Создаем голосовое подключение
     * @param config - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     * @public
     */
    public constructor(config: VoiceConnectionConfig, adapterCreator: DiscordGatewayAdapterCreator) {
        this.configuration = config;
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet: GatewayVoiceServerUpdateDispatchData) => {
                this.adapter.packets.server = packet;

                if (packet.endpoint) this.configureSocket();
                else if (this.status !== VoiceConnectionStatus.Destroyed) this.state.status = VoiceConnectionStatus.Disconnected;
            },
            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             * @private
             */
            onVoiceStateUpdate: (packet: GatewayVoiceStateUpdateDispatchData) => {
                this.adapter.packets.state = packet;
                if (packet.channel_id) this.configuration.channel_id = packet.channel_id;
            },
            destroy: this.destroy
        });

        // Отправляем данные что мы хотим подключится
        this.adapter.sendPayload(this.config);
    };

    /**
     * @description Переподключение к текущему каналу или новому голосовому каналу
     * @param configuration - Данные канала для переподключения
     * @public
     */
    public rejoin = (configuration?: VoiceConnectionConfig) => {
        // Если статус не дает переподключиться
        if (this.status === VoiceConnectionStatus.Destroyed) return false;

        // Если еще можно переподключиться
        else if (this.adapter.sendPayload(this.config)) {
            if (this.state.status !== VoiceConnectionStatus.Ready) this.status = VoiceConnectionStatus.Signalling;
            return true;
        }

        // Если надо создать новое голосовое подключение
        this.status = VoiceConnectionStatus.Disconnected;

        // Обновляем конфиг
        if (configuration) this.configuration = configuration;
        return false;
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
    public configureSocket = () => {
        const { server, state } = this.adapter.packets;

        // Если уничтожено голосовое подключение
        if (this.status === VoiceConnectionStatus.Destroyed || !state) return;

        // Если нет конечной точки для подключения
        else if (!server || !server.endpoint) {
            this.destroy();
            return;
        }

        // Записываем новое подключение WebSocket и SocketUDP
        this.network = new VoiceSocket({
            sessionId: state.session_id,
            endpoint: server.endpoint,
            serverId: server["guild_id"] ?? server["guildId"],
            userId: state.user_id,
            token: server.token
        });

        // Создаем Socket подключение к discord
        this.status = VoiceConnectionStatus.Connecting;
    };

    /**
     * @description Функция события close класса VoiceSocket
     * @param code - Код закрытия
     * @private
     */
    private VoiceSocketClose = (code: number) => {
        // Если голосовое подключение уже уничтожено
        if (this.status === VoiceConnectionStatus.Destroyed) return;

        // Если соединение было принудительно разорвано
        if (code === 4_014 || code === 10060) {
            // Отключен - сеть здесь уже разрушена
            this.status = VoiceConnectionStatus.Disconnected;
        }

        // Если происходит что-то другое
        else {
            this.status = VoiceConnectionStatus.Signalling;

            if (!this.adapter.sendPayload(this.config)) {
                this.status = VoiceConnectionStatus.Disconnected;
            }
        }
    };

    /**
     * @description Функция события StateChange класса VoiceSocket
     * @param oldState - Предыдущее состояние
     * @param newState - Новое состояние
     * @private
     */
    private VoiceSocketStateChange = (oldState: VoiceSocketState.States, newState: VoiceSocketState.States) => {
        if (oldState.code === newState.code || this.state.status !== VoiceConnectionStatus.Connecting && this.state.status !== VoiceConnectionStatus.Ready) return;

        // Если был получен статус готовности подключения
        else if (newState.code === VoiceSocketStatusCode.ready) this.status = VoiceConnectionStatus.Ready;

        // Если был получен статус закрытия подключения
        else if (newState.code !== VoiceSocketStatusCode.close) this.status = VoiceConnectionStatus.Connecting;
    };

    /**
     * @description Функция для разрушения голосового соединения
     * @public
     */
    public destroy = () => {
        // Если подключение уже уничтожено
        if (this.status === VoiceConnectionStatus.Destroyed) return;

        // Меняем статус на уничтожен
        this.status = VoiceConnectionStatus.Destroyed;

        // Удаляем VoiceSocket
        this.network = null;
    };
}

/**
 * @author SNIPPIK
 * @description Класс для отправки данных через discord.js
 * @class VoiceAdapter
 * @private
 */
class VoiceAdapter {
    /**
     * @description
     * @public
     */
    public adapter: DiscordGatewayAdapterImplementerMethods = null;

    /**
     * @description Пакеты для работы с голосовым подключением
     * @public
     */
    public packets = {
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
     * @description Отправка данных о голосовом состоянии в Discord
     * @param config - Данные для подключения
     * @public
     */
    public sendPayload = (config: VoiceConnectionConfig) => {
        try {
            return this.adapter.sendPayload({op: GatewayOpcodes.VoiceStateUpdate, d: config });
        } catch (e) {
            console.error("hook error in adapter", e);
            return false;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для создания голосового соединения
 * @interface VoiceConnectionConfig
 * @private
 */
interface VoiceConnectionConfig {
    /**
     * @description Идентификатор гильдии
     * @private
     */
    guild_id?: string;

    /**
     * @description Идентификатор канала
     * @private
     */
    channel_id:   string;

    /**
     * @description Отключен ли звук
     * @private
     */
    self_deaf:    boolean;

    /**
     * @description Приглушен ли бот (отключен микрофон)
     */
    self_mute:    boolean;

    /**
     * @description Будет ли бот транслировать с помощью "Go Live"
     * @deprecated
     */
    self_stream?: boolean;
}