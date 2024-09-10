import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {TypedEmitter} from "tiny-typed-emitter";
import {Encryption} from "../utils/Sodium";
import {VoiceUDPSocket} from "./SocketUDP";
import {WebSocket} from "@lib/request";

/**
 * @author SNIPPIK
 * @description Время до следующей проверки жизни
 */
const TIMESTAMP_INC = (48_000 / 100) * 2;

/**
 * @author SNIPPIK
 * @description Статусы голосового подключения
 */
const socketStatus = [
    {
        name: VoiceOpcodes.Hello,
        callback: (socket: VoiceSocket, packet: {d: any, op: VoiceOpcodes}) => {
            if (socket.state.code !== VoiceSocketStatusCode.close) socket.state.ws.keepAlive = packet.d.heartbeat_interval;
        }
    },
    {
        name: VoiceOpcodes.Ready,
        callback: (socket: VoiceSocket, packet: {d: any, op: VoiceOpcodes}) => {
            if (socket.state.code === VoiceSocketStatusCode.identify) {
                const {ip, port, ssrc, modes} = packet.d;

                const udp = new VoiceUDPSocket({ip, port});
                udp.on("error", socket["GettingError"]);
                udp.once("close", socket["UDPClose"]);
                udp.getIPDiscovery(ssrc).then((localConfig) => {
                    if (socket.state.code !== VoiceSocketStatusCode.upUDP) return;
                    socket.state.ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                address: localConfig.ip,
                                port: localConfig.port,
                                mode: Encryption.mode(modes),
                            },
                        }
                    };
                    socket.state = {...socket.state, code: VoiceSocketStatusCode.protocol};
                }).catch((error: Error) => socket.emit("error", error));

                socket.state = {...socket.state, udp, code: VoiceSocketStatusCode.upUDP, connectionData: {ssrc} as any};
            }
        }
    },
    {
        name: VoiceOpcodes.SessionDescription,
        callback: (socket: VoiceSocket, packet: {d: any, op: VoiceOpcodes}) => {
            if (socket.state.code === VoiceSocketStatusCode.protocol) {
                const { mode: encryptionMode, secret_key: secretKey } = packet.d;
                socket.state = { ...socket.state, code: VoiceSocketStatusCode.ready,
                    connectionData: {
                        ...socket.state.connectionData,
                        encryptionMode,
                        secretKey: new Uint8Array(secretKey),
                        sequence: Encryption.randomNBit(16),
                        timestamp: Encryption.randomNBit(32),
                        nonce: 0,
                        nonceBuffer: Buffer.alloc(24),
                        speaking: false,
                        packetsPlayed: 0,
                    }
                };
            }
        }
    },
    {
        name: VoiceOpcodes.Resumed,
        callback: (socket: VoiceSocket) => {
            if (socket.state.code === VoiceSocketStatusCode.resume) {
                socket.state = {...socket.state, code: VoiceSocketStatusCode.ready};
                socket.state.connectionData.speaking = false;
            }
        }
    }
];

/**
 * @author SNIPPIK
 * @description Интерфейс для подключения WS с UDP для передачи пакетов на сервера discord
 * @class VoiceSocket
 */
export class VoiceSocket extends TypedEmitter<VoiceSocketEvents> {
    private _state: VoiceSocketState = {
        code: VoiceSocketStatusCode.upWS,
        connectionOptions: null,
        ws: null
    };
    /**
     * @description Текущее состояние сетевого экземпляра
     * @public
     */
    public get state() { return this._state; }

    /**
     * @description Устанавливает новое состояние для сетевого экземпляра, выполняя операции очистки там, где это необходимо
     * @public
     */
    public set state(newState) {
        //Уничтожаем WebSocket
        stateDestroyer(
            Reflect.get(this._state, "ws") as WebSocket,
            Reflect.get(newState, "ws") as WebSocket,
            (oldS) => {
                oldS.off("error", this.GettingError).off("open", this.WebSocketOpen).off("packet", this.WebSocketPacket).off("close", this.WebSocketClose)
            }
        );

        //Уничтожаем UDP подключение
        stateDestroyer(
            Reflect.get(this._state, "udp") as VoiceUDPSocket,
            Reflect.get(newState, "udp") as VoiceUDPSocket,
            (oldS) => {
                oldS.off("error", this.GettingError).off("close", this.UDPClose);
            }
        );

        this.emit("stateChange", this._state, newState);
        this._state = newState;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        const state = this.state;

        // Если нельзя по состоянию или уже бот говорит
        if (state.code !== VoiceSocketStatusCode.ready || state.connectionData.speaking === speaking) return;

        state.connectionData.speaking = speaking;
        state.ws.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking ? 1 : 0,
                delay: 0,
                ssrc: state.connectionData.ssrc,
            },
        };
    };

    /**
     * @description Отправляет аудио пакет, ранее подготовленный с помощью prepare Global Packet(opus Packet).
     * Аудио пакет израсходован и не может быть отправлен повторно.
     *
     * @public
     */
    public set playAudioPacket(opusPacket: Buffer) {
        const state = this.state;

        // Если код не соответствует с отправкой
        if (state.code !== VoiceSocketStatusCode.ready) return;

        // Если есть готовый пакет для отправки
        if (opusPacket) {
            const {connectionData} = state;
            connectionData.packetsPlayed++;
            connectionData.sequence++;
            connectionData.timestamp += TIMESTAMP_INC;

            if (connectionData.sequence >= 2 ** 16) connectionData.sequence = 0;
            else if (connectionData.timestamp >= 2 ** 32) connectionData.timestamp = 0;

            this.speaking = true;

            // Зашифровываем пакет для отправки на сервера discord
            state.udp.packet = Encryption.packet(opusPacket, state.connectionData);
        }
    };

    /**
     * @description Создаем класс VoiceSocket
     * @param options
     */
    public constructor(options: ConnectionOptions) {
        super();
        Object.assign(this._state, {
            ws: this.createWebSocket(options.endpoint),
            connectionOptions: options
        });
    };

    /**
     * @description Создает новый веб-сокет для голосового шлюза Discord.
     * @param endpoint - Конечная точка, к которой нужно подключиться
     * @private
     */
    private readonly createWebSocket = (endpoint: string) => {
        return new WebSocket(`wss://${endpoint}?v=4`).on("error", this.GettingError).once("open", this.WebSocketOpen)
            .on("packet", this.WebSocketPacket).once("close", this.WebSocketClose);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     * @private
     */
    private readonly WebSocketOpen = () => {
        const state = this.state;
        const isResume = state.code === VoiceSocketStatusCode.resume;
        const isWs = state.code === VoiceSocketStatusCode.upWS;

        if (isResume || isWs) {
            if (isWs) this.state = { ...this.state, code: VoiceSocketStatusCode.identify } as IdentifyState;

            state.ws.packet = {
                op: isResume ? VoiceOpcodes.Resume : VoiceOpcodes.Identify,
                d: {
                    server_id: state.connectionOptions.serverId,
                    session_id: state.connectionOptions.sessionId,
                    user_id: isWs ? state.connectionOptions.userId : null,
                    token: state.connectionOptions.token,
                }
            };
        }
    };

    /**
     * @description Вызывается при закрытии веб-сокета. В зависимости от причины закрытия (заданной параметром code)
     * экземпляр либо попытается возобновить работу, либо перейдет в закрытое состояние и выдаст событие "close"
     * с кодом закрытия, позволяя пользователю решить, хочет ли он повторно подключиться.
     * @param code - Код закрытия
     * @private
     * @readonly
     */
    private readonly WebSocketClose = ({ code }: {code: number}) => {
        const state = this.state;

        // Если надо возобновить соединение с discord
        if (code === 4_015 || code < 4_000) {
            if (state.code === VoiceSocketStatusCode.ready) this.state = { ...state,
                ws: this.createWebSocket(state.connectionOptions?.endpoint),
                code: VoiceSocketStatusCode.resume
            };
        }

        // Если надо приостановить соединение с discord
        else if (state.code !== VoiceSocketStatusCode.close) {
            this.destroy();
            this.emit("close", code);
        }
    };

    /**
     * @description Вызывается при получении пакета на WebSocket соединения.
     * @param packet - Полученный пакет
     * @private
     */
    private readonly WebSocketPacket = (packet: {d: any, op: VoiceOpcodes}): void => {
        const status = socketStatus.find((item) => item.name === packet.op);

        // Если есть возможность выполнить функцию
        if (status && status.callback) status.callback(this, packet);
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     * @private
     * @readonly
     */
    private readonly GettingError = (error: Error): void => {
        this.emit("error", error);
    };

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     * @private
     * @readonly
     */
    private readonly UDPClose = (): void => {
        // Если статус код соответствует с VoiceSocketStatusCode.ready, то возобновляем работу
        if (this.state.code === VoiceSocketStatusCode.ready) this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: VoiceSocketStatusCode.resume
        };
    };

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy = (): void => {
        this.state = { code: VoiceSocketStatusCode.close };
    };
}

/**
 * @description Уничтожаем не используемый WebSocket или SocketUDP
 * @param oldS - Прошлое состояние
 * @param newS - Новое состояние
 * @param callback - Функция по удалению
 */
export function stateDestroyer<O>(oldS: O, newS: O, callback: (oldS: O, newS: O) => void) {
    if (oldS && oldS !== newS) {
        // Уничтожаем прошлое... удаляем класс если есть функция для уничтожения
        if (oldS["destroy"]) oldS["destroy"]();

        callback(oldS, newS);
    }
}

/**
 * @description Различные статусы, которые может иметь сетевой экземпляр. Порядок
 * состояний между открытиями и готовностью является хронологическим (сначала
 * экземпляр переходит к открытиям, затем к идентификации и т.д.)
 */
export enum VoiceSocketStatusCode {
    upWS, identify, upUDP, protocol, ready, resume, close
}


/**
 * @description Ивенты для VoiceSocket
 * @interface VoiceSocketEvents
 */
interface VoiceSocketEvents {
    "stateChange": (oldState: VoiceSocketState, newState: VoiceSocketState) => void;
    "error": (error: Error) => void;
    "close": (code: number) => void;
}

/**
 * @description Сокет создал VoiceWebSocket
 * @interface Socket_ws_State
 */
interface Socket_ws_State {
    ws: WebSocket;
    connectionOptions: ConnectionOptions;
}

/**
 * @description Сокет создал VoiceUDPSocket
 */
interface Socket_udp_State {
    udp: VoiceUDPSocket;
    connectionData: ConnectionData;
}

/**
 * @description Все статусы
 * @class VoiceSocket
 */
export type VoiceSocketState =
    WebSocketState
    | IdentifyState
    | UDPSocketState
    | ProtocolState
    | ReadyState
    | ResumeState
    | CloseState;

/**
 * @status VoiceSocketStatusCode.close
 * @description Статус о закрытии подключения
 */
interface CloseState {
    code: VoiceSocketStatusCode.close;
}

/**
 * @status VoiceSocketStatusCode.upWS
 * @description Статус запуска VoiceWebSocket
 */
interface WebSocketState extends Socket_ws_State {
    code: VoiceSocketStatusCode.upWS;
}

/**
 * @status VoiceSocketStatusCode.identify
 * @description Статус индификации
 */
interface IdentifyState extends Socket_ws_State {
    code: VoiceSocketStatusCode.identify;
}

/**
 * @status VoiceSocketStatusCode.upUDP
 * @description Статус запуска VoiceUDPSocket
 */
interface UDPSocketState extends Socket_ws_State, Socket_udp_State {
    code: VoiceSocketStatusCode.upUDP;
}

/**
 * @status VoiceSocketStatusCode.protocol
 * @description Статус определения протокола
 */
interface ProtocolState extends Socket_ws_State, Socket_udp_State {
    code: VoiceSocketStatusCode.protocol;
}

/**
 * @status VoiceSocketStatusCode.ready
 * @description Статус о готовности голосового подключения
 */
interface ReadyState extends Socket_ws_State, Socket_udp_State {
    code: VoiceSocketStatusCode.ready;
}

/**
 * @status VoiceSocketStatusCode.resume
 * @description Статус о возобновлении подключения
 */
interface ResumeState extends Socket_ws_State, Socket_udp_State {
    code: VoiceSocketStatusCode.resume;
}

/**
 * @description Сведения, необходимые для подключения к голосовому шлюзу Discord. Эти сведения
 * сначала поступают на главный шлюз бота в виде пакетов VOICE_SERVER_UPDATE
 * и VOICE_STATE_UPDATE.
 *
 * @link https://discord.com/developers/docs/topics/voice-connections
 */
interface ConnectionOptions {
    endpoint: string;
    serverId: string;
    sessionId: string;
    token: string;
    userId: string;
}

/**
 * @description Информация о текущем соединении, например, какой режим шифрования должен использоваться при
 * соединении, информации о времени воспроизведения потоков.
 *
 * @link https://discord.com/developers/docs/topics/voice-connections
 */
export interface ConnectionData {
    encryptionMode: string;
    nonce: number;
    nonceBuffer: Buffer;
    packetsPlayed: number;
    secretKey: Uint8Array;
    sequence: number;
    speaking: boolean;
    ssrc: number;
    timestamp: number;
}