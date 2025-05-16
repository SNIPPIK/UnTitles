import {GatewayVoiceServerUpdateDispatchData, GatewayVoiceStateUpdateDispatchData} from "discord-api-types/v10";
import {DiscordGatewayAdapterCreator} from "@structures/discord/modules/VoiceManager";
import {ClientWebSocket} from "./sockets/ClientWebSocket";
import {ClientUDPSocket} from "./sockets/ClientUDPSocket";
import {ClientRTPSocket} from "./sockets/ClientRTPSocket";
import {VoiceOpcodes} from "discord-api-types/voice";
import {VoiceAdapter} from "./adapter";

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
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param packet - Пакет Opus для воспроизведения
     * @public
     */
    public set packet(packet: Buffer) {
        if (this.udpClient && this.rtpClient) {
            this.speaking = true;

            this.udpClient.packet = this.rtpClient.packet(packet);
        }
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        return !!this.rtpClient && !!this.udpClient && !!this.websocket;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        // Если нельзя по состоянию или уже бот говорит
        if (this.configuration.self_mute === speaking) return;

        this.configuration.self_mute = speaking;
        this.websocket.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking ? 1 : 0,
                delay: 0,
                ssrc: this.websocket.ssrc
            },
            seq: this.websocket.req.seq
        }
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
                if (packet.endpoint) this.createClientWebSocket(packet.endpoint);
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
        // Отправляем в discord сообщение об отключении бота
        if (!this.adapter.sendPayload(this.configuration)) return false;

        this.destroy();
        return true;
    };

    /**
     * @description Подключаемся по websocket к серверу
     * @param endpoint - точка входа
     * @private
     */
    private createClientWebSocket(endpoint: string) {
        this.websocket = new ClientWebSocket(`wss://${endpoint}?v=8`);
        this.websocket.connect();

        this.websocket.on("debug", console.log);
        this.websocket.on("warn", console.log);

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

        // Подключаем UDP
        this.websocket.on("ready", (d) => {
            this.udpClient = new ClientUDPSocket(d);

            this.udpClient.discovery = d.ssrc;
            this.udpClient.on("connected", (options) => {
                this.websocket.packet = {
                    op: VoiceOpcodes.SelectProtocol,
                    d: {
                        protocol: "udp",
                        data: {
                            address: options.ip,
                            port: options.port,
                            mode: ClientRTPSocket.mode
                        },
                    }
                };
            });
        });

        // Получаем данные для отправки пакетов
        this.websocket.on("session_description", (d) => {

            this.rtpClient = new ClientRTPSocket({
                key: new Uint8Array(d.secret_key),
                ssrc: this.websocket.ssrc
            });
        });
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        this.websocket.emitDestroy();
        this.rtpClient = null;
        this.udpClient.destroy();
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