import {Encryption, TIMESTAMP_INC, VoiceUDPSocket} from "@service/voice";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {WebSocket} from "./WebSocket";
import {TypedEmitter} from "@utils";

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
    private readonly _state: VoiceSocketState.States = null;
    /**
     * @description Текущее состояние сетевого экземпляра
     * @public
     */
    public get state() {
        return this._state;
    };

    /**
     * @description Устанавливает новое состояние для сетевого экземпляра, выполняя операции очистки там, где это необходимо
     * @public
     */
    public set state(newState) {
        try {
            // Уничтожаем прошлый WebSocket
            stateDestroyer(
                Reflect.get(this._state, "ws") as WebSocket,
                Reflect.get(newState, "ws") as WebSocket,
                (oldS) => {
                    oldS
                        .off("error", this.emitError)
                        .off("open", this.openWebSocket)
                        .off("packet", this.WebSocketPacket)
                        .off("close", this.WebSocketClose)
                        .destroy()
                }
            );

            // Уничтожаем прошлое UDP подключение
            stateDestroyer(
                Reflect.get(this._state, "udp") as VoiceUDPSocket,
                Reflect.get(newState, "udp") as VoiceUDPSocket,
                (oldS) => {
                    oldS
                        .off("error", this.emitError)
                        .off("close", this.closeUDP)
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
     * @private
     */
    private createWebSocket = (endpoint: string): WebSocket => {
        return new WebSocket(`wss://${endpoint}?v=4`).on("error", this.emitError).once("open", this.openWebSocket)
            .on("packet", this.WebSocketPacket).once("close", this.WebSocketClose);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     * @private
     */
    private openWebSocket = () => {
        const state = this.state;
        const isResume = state.code === VoiceSocketStatusCode.resume;
        const isWs = state.code === VoiceSocketStatusCode.upWS;

        if (isResume || isWs) {
            if (isWs) this.state = { ...state, code: VoiceSocketStatusCode.identify };

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
     * @private
     */
    private WebSocketClose = ({ code }: {code: number}) => {
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
     * @private
     */
    private WebSocketPacket = (packet: {d: any, op: VoiceOpcodes}): void => {
        /**
         * @description Если получен код о готовности подключения к голосовому каналу
         * @private
         */
        if (packet.op === VoiceOpcodes.Ready) {
            if (this.state.code === VoiceSocketStatusCode.identify) {
                const {ip, port, ssrc} = packet.d;
                const udp = new VoiceUDPSocket({ip, port});

                // Получаем ip и порт сервера голосового подключения
                udp.discovery(ssrc)

                    .then((localConfig) => {
                        if (this.state.code !== VoiceSocketStatusCode.upUDP) return;

                        // Отправляем пакет, о подключении к сокету
                        this.state = {...this.state, code: VoiceSocketStatusCode.protocol};
                        this.state.ws.packet = {
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
                    })

                    .catch((error: Error) => {
                        // Если произошла ошибка при работе с сокетом
                        if (`${error}`.match("Timeout")) return;

                        // Если получена не отслеживаемая ошибка
                        this.emit("error", error);
                    });

                udp.on("error", this.emitError);
                udp.once("close", this.closeUDP);

                this.state = {...this.state, udp, code: VoiceSocketStatusCode.upUDP, connectionData: {ssrc} as any};
            }
        }

        /**
         * @description Если получен код о параметрах голосового соединения, то задаем их
         * @private
         */
        else if (packet.op === VoiceOpcodes.SessionDescription) {
            if (this.state.code === VoiceSocketStatusCode.protocol) {
                const { mode: encryptionMode, secret_key } = packet.d;
                this.state = { ...this.state, code: VoiceSocketStatusCode.ready,
                    connectionData: {
                        ...this.state.connectionData,
                        encryptionMode,
                        secretKey: new Uint8Array(secret_key),
                        sequence: Encryption.randomNBit(16),
                        timestamp: Encryption.randomNBit(32),
                        nonce: 0,
                        nonceBuffer: Encryption.nonce,
                        speaking: false,
                        packetsPlayed: 0,
                    }
                };
            }
        }

        /**
         * @description Если получен код о ...
         * @private
         */
        else if (packet.op === VoiceOpcodes.Resumed) {
            if (this.state.code === VoiceSocketStatusCode.resume) {
                this.state = {...this.state, code: VoiceSocketStatusCode.ready};
                this.state.connectionData.speaking = false;
            }
        }

        /**
         * @description Если получен код о необходимости ответа сервера
         * @private
         */
        else if (packet.op === VoiceOpcodes.Hello) {
            // Задаем время жизни голосового подключения
            if (this.state.code !== VoiceSocketStatusCode.close) this.state.ws.keepAlive = packet.d.heartbeat_interval;
        }
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     * @private
     */
    private emitError = (error: Error): void => {
        this.emit("error", error);
    };

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     * @private
     */
    private closeUDP = (): void => {
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
 * @author SNIPPIK
 * @description События для VoiceSocket
 * @interface VoiceSocketEvents
 */
interface VoiceSocketEvents {
    "stateChange": (oldState: VoiceSocketState.States, newState: VoiceSocketState.States) => void;
    "error": (error: Error) => void;
    "close": (code: number) => void;
}

/**
 * @author SNIPPIK
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
 * @author SNIPPIK
 * @description Все состояния подключения к серверу discord
 * @namespace VoiceSocketState
 */
export namespace VoiceSocketState {
    /**
     * @description Сокет создал VoiceWebSocket
     * @interface WebSocket_Base
     */
    interface WebSocket_Base {
        ws: WebSocket;
        connectionOptions: ConnectionOptions;
    }

    /**
     * @description Сокет создал VoiceUDPSocket
     */
    interface UDPSocket_Base {
        udp: VoiceUDPSocket;
        connectionData: ConnectionData;
    }

    /**
     * @description Все статусы
     * @class VoiceSocket
     */
    export type States = WebSocketState | Identify | UDPSocket | Protocol | Ready | Resume | Close;

    /**
     * @status VoiceSocketStatusCode.close
     * @description Статус о закрытии подключения
     */
    interface Close {
        code: VoiceSocketStatusCode.close;
    }

    /**
     * @status VoiceSocketStatusCode.upWS
     * @description Статус запуска VoiceWebSocket
     */
    interface WebSocketState extends WebSocket_Base {
        code: VoiceSocketStatusCode.upWS;
    }

    /**
     * @status VoiceSocketStatusCode.identify
     * @description Статус идентификации
     */
    interface Identify extends WebSocket_Base {
        code: VoiceSocketStatusCode.identify;
    }

    /**
     * @status VoiceSocketStatusCode.upUDP
     * @description Статус запуска VoiceUDPSocket
     */
    interface UDPSocket extends WebSocket_Base, UDPSocket_Base {
        code: VoiceSocketStatusCode.upUDP;
    }

    /**
     * @status VoiceSocketStatusCode.protocol
     * @description Статус определения протокола
     */
    interface Protocol extends WebSocket_Base, UDPSocket_Base {
        code: VoiceSocketStatusCode.protocol;
    }

    /**
     * @status VoiceSocketStatusCode.ready
     * @description Статус о готовности голосового подключения
     */
    interface Ready extends WebSocket_Base, UDPSocket_Base {
        code: VoiceSocketStatusCode.ready;
    }

    /**
     * @status VoiceSocketStatusCode.resume
     * @description Статус о возобновлении подключения
     */
    interface Resume extends WebSocket_Base, UDPSocket_Base {
        code: VoiceSocketStatusCode.resume;
    }
}

/**
 * @author SNIPPIK
 * @description Различные статусы, которые может иметь сетевой экземпляр. Порядок
 * состояний между открытиями и готовностью является хронологическим (сначала
 * экземпляр переходит к открытиям, затем к идентификации и т.д.)
 */
export enum VoiceSocketStatusCode {
    upWS, identify, upUDP, protocol, ready, resume, close
}

/**
 * @author SNIPPIK
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
 * @author SNIPPIK
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