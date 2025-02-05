import {Encryption, VoiceUDPSocket} from "@service/voice";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {WebSocket} from "@handler/apis";
import {TypedEmitter} from "@utils";
import * as console from "node:console";

/**
 * @author SNIPPIK
 * @description Время до следующей проверки жизни
 * @private
 */
const TIMESTAMP_INC = (48_000 / 100) * 2;

/**
 * @author SNIPPIK
 * @description Статусы голосового подключения
 * @private
 */
const socketStatus: {name: VoiceOpcodes, callback: (socket: VoiceSocket, packet?: {d: any, op: VoiceOpcodes}) => void}[] = [
    /**
     * @description Устанавливаем соединение
     * @private
     */
    {
        name: VoiceOpcodes.Hello,
        callback: (socket, packet) => {
            if (socket.state.code !== VoiceSocketStatusCode.close) socket.state.ws.keepAlive = packet.d.heartbeat_interval;
        }
    },

    /**
     * @description Сообщаем класс и соединение о готовности
     * @private
     */
    {
        name: VoiceOpcodes.Ready,
        callback: (socket, packet) => {
            if (socket.state.code === VoiceSocketStatusCode.identify) {
                const {ip, port, ssrc} = packet.d;
                const udp = new VoiceUDPSocket({ip, port});

                // Получаем ip и порт сервера голосового подключения
                udp.discovery(ssrc).then((localConfig) => {
                    if (socket.state.code !== VoiceSocketStatusCode.upUDP) return;

                    // Отправляем пакет, о подключении к сокету
                    socket.state = {...socket.state, code: VoiceSocketStatusCode.protocol};
                    socket.state.ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                address: localConfig.ip,
                                port: localConfig.port,
                                mode: Encryption.mode,
                            },
                        }
                    };
                }).catch((error: Error) => {
                    // Если произошла ошибка при работе с сокетом
                    if (`${error}`.match("Timeout")) return;

                    // Если получена не отслеживаемая ошибка
                    socket.emit("error", error);
                });

                udp.on("error", socket["GettingError"]);
                udp.once("close", socket["UDPClose"]);

                socket.state = {...socket.state, udp, code: VoiceSocketStatusCode.upUDP, connectionData: {ssrc} as any};
            }
        }
    },

    /**
     * @description Задаем описание сессии
     * @private
     */
    {
        name: VoiceOpcodes.SessionDescription,
        callback: (socket, packet) => {
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
                        nonceBuffer: Buffer.alloc(12),
                        speaking: false,
                        packetsPlayed: 0,
                    }
                };
            }
        }
    },

    /**
     * @description Сообщаем о продолжении подключения
     * @private
     */
    {
        name: VoiceOpcodes.Resumed,
        callback: (socket) => {
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
 * @public
 */
export class VoiceSocket extends TypedEmitter<VoiceSocketEvents> {
    /**
     * @description Текущий статус подключения
     * @private
     */
    private readonly _state: VoiceSocketState = null;
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
        try {
            // Уничтожаем WebSocket
            stateDestroyer(
                Reflect.get(this._state, "ws") as WebSocket,
                Reflect.get(newState, "ws") as WebSocket,
                (oldS) => {
                    oldS
                        .off("error", this.GettingError)
                        .off("open", this.WebSocketOpen)
                        .off("packet", this.WebSocketPacket)
                        .off("close", this.WebSocketClose)
                        .destroy()
                }
            );

            // Уничтожаем UDP подключение
            stateDestroyer(
                Reflect.get(this._state, "udp") as VoiceUDPSocket,
                Reflect.get(newState, "udp") as VoiceUDPSocket,
                (oldS) => {
                    oldS
                        .off("error", this.GettingError)
                        .off("close", this.UDPClose)
                        .destroy();
                }
            );

            this.emit("stateChange", this._state, newState);
            Object.assign(this._state, newState);
        } catch (err) {
            // Если было произведено экстренное удаление подключения
            if (`${err}`.match("Reflect.get called on non-object")) return;

            console.error(err);
        }
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
                ssrc: state.connectionData.ssrc
            }
        };
    };

    /**
     * @description Отправляет аудио пакет, ранее подготовленный с помощью prepare modules Packet(opus Packet).
     * Аудио пакет израсходован и не может быть отправлен повторно.
     *
     * @public
     */
    public set cryptoPacket(opusPacket: Buffer) {
        const state = this.state;

        // Если код не соответствует с отправкой
        if (state.code !== VoiceSocketStatusCode.ready) return;

        // Если есть готовый пакет для отправки
        if (opusPacket) {
            const {connectionData, udp} = state;
            connectionData.packetsPlayed++;
            connectionData.sequence++;
            connectionData.timestamp += TIMESTAMP_INC;

            if (connectionData.sequence >= 2 ** 16) connectionData.sequence = 0;
            else if (connectionData.timestamp >= 2 ** 32) connectionData.timestamp = 0;

            // Принудительно включаем передачу голоса
            this.speaking = true;

            // Зашифровываем пакет для отправки на сервера discord
            udp.packet = Encryption.packet(opusPacket, connectionData);
        }
    };

    /**
     * @description Создаем класс VoiceSocket
     * @param options
     */
    public constructor(options: ConnectionOptions) {
        super();
        this._state = {
            ws: this.createWebSocket(options.endpoint),
            code: VoiceSocketStatusCode.upWS,
            connectionOptions: options
        };
    };

    /**
     * @description Создает новый веб-сокет для голосового шлюза Discord.
     * @param endpoint - Конечная точка, к которой нужно подключиться
     * @readonly
     * @private
     */
    private readonly createWebSocket = (endpoint: string): WebSocket => {
        return new WebSocket(`wss://${endpoint}?v=4`).on("error", this.GettingError).once("open", this.WebSocketOpen)
            .on("packet", this.WebSocketPacket).once("close", this.WebSocketClose);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     * @readonly
     * @private
     */
    private readonly WebSocketOpen = () => {
        const state = this.state;
        const isResume = state.code === VoiceSocketStatusCode.resume;
        const isWs = state.code === VoiceSocketStatusCode.upWS;

        if (isResume || isWs) {
            if (isWs) this.state = { ...state, code: VoiceSocketStatusCode.identify } as IdentifyState;

            state.ws.packet = {
                op: isResume ? VoiceOpcodes.Resume : VoiceOpcodes.Identify,
                d: {
                    server_id: state.connectionOptions.serverId,
                    session_id: state.connectionOptions.sessionId,
                    user_id: isWs ? state.connectionOptions.userId : null,
                    token: state.connectionOptions.token
                }
            };
        }
    };

    /**
     * @description Вызывается при закрытии веб-сокета. В зависимости от причины закрытия (заданной параметром code)
     * экземпляр либо попытается возобновить работу, либо перейдет в закрытое состояние и выдаст событие "close"
     * с кодом закрытия, позволяя пользователю решить, хочет ли он повторно подключиться.
     * @param code - Код закрытия
     * @readonly
     * @private
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
     * @description Вызывается при получении пакета от WebSocket
     * @param packet - Полученный пакет
     * @readonly
     * @private
     */
    private readonly WebSocketPacket = (packet: {d: any, op: VoiceOpcodes}): void => {
        const status = socketStatus.find((status) => status.name === packet.op);

        // Если есть возможность выполнить функцию
        if (status && status.callback) status.callback(this, packet);
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     * @readonly
     * @private
     */
    private readonly GettingError = (error: Error): void => {
        this.emit("error", error);
    };

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     * @readonly
     * @private
     */
    private readonly UDPClose = (): void => {
        const state = this.state;

        // Если статус код соответствует с VoiceSocketStatusCode.ready, то возобновляем работу
        if (state.code === VoiceSocketStatusCode.ready) this.state = { ...state,
            ws: this.createWebSocket(state.connectionOptions.endpoint),
            code: VoiceSocketStatusCode.resume
        };
    };

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy = (): void => {
        // Удаляем данные в следующем цикле
        setImmediate(() => {
            this.state = {code: VoiceSocketStatusCode.close};
            for (let key of Object.keys(this)) this[key] = null;
        });
    };
}

/**
 * @description Уничтожаем не используемый WebSocket или SocketUDP
 * @param oldS - Прошлое состояние
 * @param newS - Новое состояние
 * @param callback - Функция по удалению
 */
export function stateDestroyer<O extends WebSocket | VoiceUDPSocket | VoiceSocket>(oldS: O, newS: O, callback: (oldS: O, newS: O) => void) {
    try {
        if (oldS && oldS !== newS) callback(oldS, newS);
    } catch (err) {
        console.error(err);
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
 * @description События для VoiceSocket
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
export type VoiceSocketState = WebSocketState | IdentifyState | UDPSocketState | ProtocolState | ReadyState | ResumeState | CloseState;

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
 * @description Статус идентификации
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