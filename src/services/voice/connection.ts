import { GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData } from "discord-api-types/v10";
import { VoiceAdapter, DiscordGatewayAdapterCreator } from "./adapter";
import { ClientWebSocket, opcode } from "./sockets/ClientWebSocket";
import { ClientUDPSocket } from "./sockets/ClientUDPSocket";
import { ClientRTPSocket } from "./sockets/ClientRTPSocket";
import { VoiceOpcodes } from "discord-api-types/voice";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection {
    /**
     * @description Функции для общения с websocket клиента
     * @public
     */
    public readonly adapter: VoiceAdapter = new VoiceAdapter();

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @private
     */
    private websocket: ClientWebSocket;

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @private
     */
    private udpClient: ClientUDPSocket;

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @private
     */
    private rtpClient: ClientRTPSocket;

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
        ssrc: 0 as number,
        secret_key: null as number[],
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param packet - Пакет Opus для воспроизведения
     * @public
     */
    public set packet(packet: Buffer) {
        if (this.udpClient && this.rtpClient) {
            this.speaking = true;

            this.udpClient.packet = this.rtpClient.packet(packet);
            this.resetSpeakingTimeout();
        }
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        return !!this.rtpClient && !!this.udpClient && !!this.websocket && this.websocket.ready;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        // Если нельзя по состоянию или уже бот говорит
        if (this._speaking === speaking) return;

        this._speaking = speaking;
        this.configuration.self_mute = !speaking;

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
     * @description Данные из VOICE_STATE_UPDATE
     * @private
     */
    private get voiceState() {
        return this.adapter.packet.state;
    };

    /**
     * @description Данные из VOICE_SERVER_UPDATE
     * @private
     */
    private get serverState() {
        return this.adapter.packet.server;
    };

    /**
     * @description Создание RTP подключения
     * @param d - Пакет opcode.session
     */
    private set ClientRTP(d: opcode.session["d"]) {
        if (this.rtpClient) {
            // Если текущие данные совпадают с прошлыми
            if (d.secret_key === this._attention.secret_key) return;

            this.rtpClient = null;
        }

        // Создаем подключение RTP
        this.rtpClient = new ClientRTPSocket({
            key: new Uint8Array(d.secret_key),
            ssrc: this._attention.ssrc
        });

        this._attention.secret_key = d.secret_key;
    };

    /**
     * @description Создание udp подключения
     * @param d - Пакет opcode.ready
     */
    private set ClientUDP(d: opcode.ready["d"]) {
        const select_protocol = () => {
            const {ip, port} = this.udpClient._discovery

            this.websocket.packet = {
                op: VoiceOpcodes.SelectProtocol,
                d: {
                    protocol: "udp",
                    data: {
                        address: ip,
                        port: port,
                        mode: ClientRTPSocket.mode
                    }
                }
            };
        };

        // Если есть UDP подключение
        if (this.udpClient) {
            this._speaking = false;

            // Сверяем данные
            if (d.ssrc === this._attention?.ssrc) return;

            this.udpClient.destroy();
            this.udpClient = null;
        }

        this.udpClient = new ClientUDPSocket(d);
        this.udpClient.discovery(d.ssrc);

        // Подключаемся к UDP серверу
        this.udpClient.on("connected", select_protocol);

        // Отлавливаем ошибки при отправке пакетов
        this.udpClient.on("error", (error) => {
            this.websocket.emit("warn", `UDP Error: ${error.message}. Reinitializing UDP socket...`);
        });

        this._attention.ssrc = d.ssrc;
    };

    /**
     * @description Подключаемся по websocket к серверу
     * @param endpoint - точка входа
     * @private
     */
    private set ClientWS(endpoint: string) {
        // Если есть прошлый websocket
        if (this.websocket) {
            this.websocket.removeAllListeners();
            this.websocket.destroy();
            this.websocket = null;
        }

        // Создаем websocket
        this.websocket = new ClientWebSocket(`wss://${endpoint}?v=8`);
        this.websocket.connect(); // Подключаемся к endpoint

        //this.websocket.on("debug", console.log);
        //this.websocket.on("warn", console.log);

        this.websocket.on("error", (err) => {
            this.websocket.emit("close", 4000 as any, err.name);
        });

        // Обрабатываем общий пакет данных
        this.websocket.on("packet", ({op, d}) => {
            switch (op) {
                // Подключаем UDP
                case VoiceOpcodes.SessionDescription: {
                    this.speaking = false;

                    this.ClientRTP = d;
                    break;
                }

                // Получаем данные для отправки пакетов
                case VoiceOpcodes.Ready: {
                    this.ClientUDP = d;

                    // После установки UDP и RTP, включаем speaking
                    this.resetSpeakingTimeout();
                    break;
                }
            }
        });

        // Подключаемся к websocket'у discord'а
        this.websocket.on("connect", () => {
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

        // Если websocket требует возобновления подключения
        this.websocket.on("request_resume", () => {
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

        // Если Websocket завершил свою работу
        this.websocket.on("close", (code, reason) => {
            if (code === 1000) return this.destroy();

            this.websocket.emit("debug", `[${code}] ${reason}. Reconstruct...`);
            this.ClientWS = this.serverState.endpoint;
        });
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
                if (packet.endpoint) this.ClientWS = packet.endpoint;
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
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public disconnect = () => {
        this.configuration.channel_id = null;

        // Отправляем в discord сообщение об отключении бота
        return this.adapter.sendPayload(this.configuration);
    };

    /**
     * @description Сброс таймера отключения Speaking
     * @private
     */
    private resetSpeakingTimeout = () => {
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        // Выставляем таймер смены на false
        this.speakingTimeout = setTimeout(() => {  this.speaking = false; }, 2e3);
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        if (this.websocket && this.udpClient) {
            this.websocket?.destroy();
            this.udpClient?.destroy();
        }

        this.rtpClient = null;
        this.websocket = null;
        this.udpClient = null;

        this.speakingTimeout = null;
        this._speaking = false;
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для создания голосового соединения
 * @interface VoiceConnectionConfiguration
 * @private
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