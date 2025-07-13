import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import { VoiceAdapter, DiscordGatewayAdapterCreator } from "./adapter";
import { VoiceReceiver } from "#service/voice/managers/receiver";
import { ClientSRTPSocket } from "./sockets/ClientSRTPSocket";
import { ClientWebSocket } from "./sockets/ClientWebSocket";
import { ClientUDPSocket } from "./sockets/ClientUDPSocket";
import { WebSocketOpcodes } from "#service/voice/index";
import { VoiceOpcodes } from "discord-api-types/voice";

/**
 * @author SNIPPIK
 * @description Время через которое меняется speaking статус
 * @const KEEP_SWITCH_SPEAKING
 */
const KEEP_SWITCH_SPEAKING = 5e3;

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection {
    /**
     * @description Класс слушателя, если надо слушать пользователей
     * @usage нужно указать self_deaf = false
     * @readonly
     * @public
     */
    public readonly receiver: VoiceReceiver;

    /**
     * @description Функции для общения с websocket клиента
     * @readonly
     * @public
     */
    public readonly adapter: VoiceAdapter = new VoiceAdapter();

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @private
     */
    protected websocket: ClientWebSocket = new ClientWebSocket();

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @private
     */
    protected clientUDP: ClientUDPSocket = new ClientUDPSocket();

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @private
     */
    protected clientSRTP: ClientSRTPSocket;

    /**
     * @description Таймер для автоматического отключения Speaking
     * @private
     */
    private speakingTimeout: NodeJS.Timeout | null = null;

    /**
     * @description Текущее состояние Speaking (включен/выключен)
     * @private
     */
    private _speaking: boolean = false;

    /**
     * @description Дополнительные данные подключения
     * @private
     */
    private _attention = {
        ssrc: null as number,
        secret_key: null as number[],
    };

    /**
     * @description Текущий статус подключения
     * @private
     */
    private _status: VoiceConnectionStatus;

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param packet - Аудио пакет OPUS
     * @public
     */
    public set packet(packet: Buffer) {
        if (this._status === VoiceConnectionStatus.ready && packet) {
            this.speaking = true;
            this.resetSpeakingTimeout();

            // Если есть клиенты для шифрования и отправки
            if (this.clientUDP && this.clientSRTP) {
                this.clientUDP.packet = this.clientSRTP.packet(packet);
            }
        }
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        // Если статус не готовности
        if (this._status !== VoiceConnectionStatus.ready) return false;

        // Если нет клиентов для передачи аудио
        else if (!this.clientSRTP && !this.clientUDP) return false;

        // Если основных данных нет
        return this.clientUDP.connected && this.websocket && this.websocket.connected;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        // Если нельзя по состоянию или уже бот говорит
        if (this._speaking === speaking) return;

        // Меняем состояние спикера
        this._speaking = speaking;

        // Обновляем статус голоса
        this.websocket.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking ? 1 : 0,
                delay: 0,
                ssrc: this._attention.ssrc
            },
            seq: this.websocket.lastAsk
        };
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public get disconnect() {
        this._status = VoiceConnectionStatus.disconnected;
        this.configuration.channel_id = null; // Удаляем id канала

        // Отправляем в discord сообщение об отключении бота
        return this.adapter.sendPayload(this.configuration);
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set swapChannel(ID: string) {
        // Прописываем новый id канала
        this.configuration = {...this.configuration, channel_id: ID};
        this.adapter.sendPayload(this.configuration);
    };

    /**
     * @description Данные из VOICE_STATE_UPDATE
     * @private
     */
    public get voiceState() {
        return this.adapter.packet.state;
    };

    /**
     * @description Данные из VOICE_SERVER_UPDATE
     * @private
     */
    public get serverState() {
        return this.adapter.packet.server;
    };

    /**
     * @description Создаем голосовое подключение
     * @param configuration - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     * @public
     */
    public constructor(public configuration: VoiceConnectionConfiguration, adapterCreator: DiscordGatewayAdapterCreator) {
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet: GatewayVoiceServerUpdateDispatchData) => {
                this.adapter.packet.server = packet;

                // Если есть точка подключения
                if (packet.endpoint) this.createWebSocket(packet.endpoint);
            },

            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             * @private
             */
            onVoiceStateUpdate: (packet: GatewayVoiceStateUpdateDispatchData) => {
                this.adapter.packet.state = packet;
            },
            destroy: this.destroy
        });

        // Инициализируем подключение
        this.adapter.sendPayload(this.configuration);
        this._status = VoiceConnectionStatus.connected;

        // Если включен програмно звук
        if (!configuration.self_deaf) {
            this.receiver = new VoiceReceiver(this);
        }
    };

    /**
     * @description Подключаемся по websocket к серверу
     * @param endpoint - точка входа
     * @private
     */
    private createWebSocket = (endpoint: string) => {
        this.websocket.connect(`wss://${endpoint}`); // Подключаемся к endpoint

        // Если включен debug режим
        //this.websocket.on("debug", console.log);
        //this.websocket.on("warn", console.log);

        /**
         * @description Отправляем Identify данные, для регистарции голосового подключения
         * @status Identify
         * @code 0
         */
        this.websocket.on("open", () => {
            this.websocket.packet = {
                op: VoiceOpcodes.Identify,
                d: {
                    server_id: this.configuration.guild_id,
                    session_id: this.voiceState.session_id,
                    user_id: this.voiceState.user_id,
                    token: this.serverState.token
                }
            };
        });

        /**
         * @description Если голосовое подключение готово, подключаемся по UDP
         * @status Ready
         * @code 2
         */
        this.websocket.on("ready", ({d}) => {
            this.createUDPSocket(d);

            // После установки UDP и RTP, включаем speaking
            this.resetSpeakingTimeout();
        });

        /**
         * @description Если голосовое подключение готово, и получены данные для шифрования пакетов
         * @status SessionDescription
         * @code 4
         */
        this.websocket.on("sessionDescription", ({d}) => {
            this._status = VoiceConnectionStatus.SessionDescription;
            this.speaking = false;

            // Если уже есть активный RTP
            if (this.clientSRTP) {
                this.clientSRTP.destroy();
                this.clientSRTP = null;
            }

            // Создаем подключение RTP
            this.clientSRTP = new ClientSRTPSocket({
                key: new Uint8Array(d.secret_key),
                ssrc: this._attention.ssrc
            });

            this._status = VoiceConnectionStatus.ready;

            // Сохраняем ключ, для повторного использования
            this._attention.secret_key = d.secret_key;
        });

        /**
         * @description Если websocket требует возобновления подключения
         * @status Resume
         * @code 7
         */
        this.websocket.on("resumed", () => {
            this.speaking = false;
            this.websocket.packet = {
                op: VoiceOpcodes.Resume,
                d: {
                    server_id: this.configuration.guild_id,
                    session_id: this.voiceState.session_id,
                    token: this.serverState.token,
                    seq_ack: this.websocket.lastAsk
                }
            };
        });

        /**
         * @description Если websocket закрывается, пытаемся его поднять или перезапустить
         * @status WS Close
         * @code 1000-4022
         */
        this.websocket.on("close", (code, reason) => {
            if (code >= 1000 && code <= 1002 || this._status === VoiceConnectionStatus.reconnecting) return this.destroy();

            // Подключения больше не существует
            else if (code === 4006 || code === 4003) {
                this.serverState.endpoint = null;
                this.voiceState.session_id = null;
                this.adapter.sendPayload(this.configuration);
                return; // Здесь происходит пересоздание ws подключения
            }

            this._status = VoiceConnectionStatus.reconnecting;

            setTimeout(() => {
                this.websocket?.emit("debug", `[${code}/${reason}] Voice Connection reconstruct ws... 500 ms`);
                this.createWebSocket(this.serverState.endpoint);
            }, 500);
        });

        /**
         * @description Если websocket получил не предвиденную ошибку, то отключаемся
         * @status WS Error
         */
        this.websocket.on("error", () => {
            this._status = VoiceConnectionStatus.disconnected;
            this.disconnect;
            this.destroy();
        });
    };

    /**
     * @description Создание udp подключения
     * @param d - Пакет opcode.ready
     */
    private createUDPSocket = (d: WebSocketOpcodes.ready["d"]) => {
        this.clientUDP.connect(d); // Подключаемся по UDP к серверу

        /**
         * @description Передаем реальный ip, port для общения с discord
         * @status SelectProtocol
         * @code 1
         */
        this.clientUDP.once("connected", ({ip, port}) => {
            this.websocket.packet = {
                op: VoiceOpcodes.SelectProtocol,
                d: {
                    protocol: "udp",
                    data: {
                        address: ip,
                        port: port,
                        mode: ClientSRTPSocket.mode
                    }
                }
            };
        });

        // Если UDP подключение разорвет соединение принудительно
        this.clientUDP.on("close", () => {
            // Если голосовое подключение полностью отключено
            if (this._status === VoiceConnectionStatus.disconnected) return;

            // Пересоздаем подключение
            this.createUDPSocket(d);

            // Debug
            this.websocket.emit("warn", `UDP Close. Reinitializing UDP socket...`);
        });

        // Отлавливаем ошибки при отправке пакетов
        this.clientUDP.on("error", (error) => {
            // Если произведена попытка подключения к закрытому каналу
            if (`${error}`.match(/Not found IPv4 address/)) {
                if (this.disconnect) this.destroy();
                return;
            }

            this.websocket.emit("warn", `UDP Error: ${error.message}. Closed voice connection!`);
        });

        this._attention.ssrc = d.ssrc;
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        if (this.websocket && this.clientUDP) {
            this.websocket?.destroy();
            this.clientUDP?.destroy();
            this.clientSRTP?.destroy();
        }

        this._status = VoiceConnectionStatus.disconnected;

        this.clientSRTP = null;
        this.websocket = null;
        this.clientUDP = null;

        this.speakingTimeout = null;
        this._speaking = null;
    };

    /**
     * @description Сброс таймера отключения Speaking
     * @private
     */
    private resetSpeakingTimeout = () => {
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        // Выставляем таймер смены на false
        this.speakingTimeout = setTimeout(() => { this.speaking = false; }, KEEP_SWITCH_SPEAKING);
    };
}

/**
 * @author SNIPPIK
 * @description Статусы подключения голосового соединения
 * @enum VoiceConnectionStatus
 * @private
 */
enum VoiceConnectionStatus {
    // Полностью готов
    ready = "ready",

    // Отключен
    disconnected = "disconnected",

    // Подключен
    connected = "connected",

    // Получение данных для подключения RTP
    SessionDescription = "sessionDescription",

    // Если происходит переподключение
    reconnecting = "reconnecting",

    userSpeaking = "userSpeaking",
    userMute = "userMute",
}

/**
 * @author SNIPPIK
 * @description Параметры для создания голосового соединения
 * @interface VoiceConnectionConfiguration
 * @public
 */
export interface VoiceConnectionConfiguration {
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