import {Encryption, TIMESTAMP_INC, SocketUDP, VoiceSocketEvents} from "@service/voice";
import {VoiceOpcodes} from "discord-api-types/voice";
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
    private _state: VoiceSocketState.States;
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
        const oldState = this._state;

        try {
            // Уничтожаем прошлый WebSocket
            if (oldState && "ws" in oldState && oldState.ws !== newState["ws"]) {
                oldState.ws
                    .off("error", this.emitError)
                    .off("open", this.WebSocketOpen)
                    .off("packet", this.WebSocketPacket)
                    .off("close", this.WebSocketClose)
                    .destroy()
            }

            // Уничтожаем прошлое UDP подключение
            if (oldState && "udp" in oldState && oldState.udp !== newState["udp"]) {
                oldState.udp
                    .off("error", this.emitError)
                    .off("close", this.SocketUDPClose)
                    .destroy();
            }

            // Если происходит попытка вызова события из уничтоженного EventEmitter
            if (oldState.code !== newState.code) this.emit("stateChange", oldState, newState);
        } catch {
            // :D
        }

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
        if (state.code !== VoiceSocketStatusCode.ready || !opusPacket) return;

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
    private createWebSocket = (endpoint: string) => {
        return new WebSocket(`wss://${endpoint}?v=8`).once("open", this.WebSocketOpen).once("close", this.WebSocketClose)
            .on("packet", this.WebSocketPacket).on("error", this.emitError);
    };

    /**
     * @description Вызывается при открытии WebSocket. В зависимости от состояния, в котором находится экземпляр,
     * он либо идентифицируется с новым сеансом, либо попытается возобновить существующий сеанс.
     * @private
     */
    private WebSocketOpen = () => {
        const state = this.state;

        switch (state.code) {

            /**
             * @description Если происходит обрыв соединения ws, то пробуем его поднять заново
             */
            case VoiceSocketStatusCode.resume: {
                state.ws.packet = {
                    op: VoiceOpcodes.Resume,
                    d: {
                        server_id: state.connectionOptions.serverId,
                        session_id: state.connectionOptions.sessionId,
                        token: state.connectionOptions.token,
                        seq_ack: state.ws.seq_ack
                    }
                };
                return
            }

            /**
             * @description Если приходит статус поднятия ws, то необходимо отослать статус индификации клиента voice
             */
            case VoiceSocketStatusCode.upWS: {
                state.ws.packet = {
                    op: VoiceOpcodes.Identify,
                    d: {
                        server_id: state.connectionOptions.serverId,
                        user_id: state.connectionOptions.userId,
                        session_id: state.connectionOptions.sessionId,
                        token: state.connectionOptions.token,
                        seq_ack: state.ws.seq_ack
                    }
                };
                this.state = {...state, code: VoiceSocketStatusCode.identify};
                return;
            }
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

        // Если discord попытался разорвать соединение
        if (code === 4_015 || code < 4_000) {
            if (state.code === VoiceSocketStatusCode.ready) {
                this.state = { ...state,
                    ws: this.createWebSocket(state.connectionOptions?.endpoint),
                    code: VoiceSocketStatusCode.resume
                };
            }
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
    private WebSocketPacket = (packet: {d: any, op: VoiceOpcodes}) => {
        switch (packet.op) {
            /**
             * @description Если получен код о готовности подключения к голосовому каналу
             * @private
             * @code 2
             */
            case VoiceOpcodes.Ready: {
                if (this.state.code !== VoiceSocketStatusCode.identify) return;

                const {ip, port, ssrc} = packet.d;
                const udp = new SocketUDP({ip, port});

                udp.on("error", this.emitError);
                udp.once("close", this.SocketUDPClose);

                // Задаем состояние о запуске UDP соединения
                this.state = {...this.state, udp, code: VoiceSocketStatusCode.upUDP, connectionData: {ssrc} as any};

                // Передаем данные для получения IP:PORT
                udp.discovery = ssrc;

                // Ждем ответа события когда можно будет подключиться к WebSocket
                udp.once("connected", (config) => {
                    if (this.state.code !== VoiceSocketStatusCode.upUDP) return;

                    // Отправляем пакет, о подключении к сокету
                    this.state = {...this.state, code: VoiceSocketStatusCode.protocol};
                    this.state.ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                address: config.ip,
                                port: config.port,
                                mode: Encryption.mode
                            },
                        }
                    };
                });
                return;
            }

            /**
             * @description Если получен код о параметрах голосового соединения, то задаем их
             * @private
             * @code 4
             */
            case VoiceOpcodes.SessionDescription: {
                if (this.state.code !== VoiceSocketStatusCode.protocol) return;
                const { mode: encryptionMode, secret_key } = packet.d;

                this.state = { ...this.state,
                    code: VoiceSocketStatusCode.ready,
                    connectionData: Object.assign(this.state.connectionData, {
                        encryptionMode,
                        secretKey: new Uint8Array(secret_key),
                        sequence: Encryption.randomNBit(16),
                        timestamp: Encryption.randomNBit(32),
                        nonce: 0,
                        nonceBuffer: Encryption.nonce,
                        speaking: false,
                        packetsPlayed: 0
                    })
                };

                return;
            }

            /**
             * @description Шлюз может привести к повторному забуференным сообщениям. Чтобы поддержать это, шлюз включает номер последовательности со всеми сообщениями, которые могут потребоваться повторно.
             * @private
             * @code 5
             */
            case VoiceOpcodes.Speaking: {
                if (this.state.code === VoiceSocketStatusCode.close) return;

                this.state.ws.packet = {
                    op: VoiceOpcodes.Speaking,
                    d: {
                        speaking: packet.d.speaking,
                        delay: packet.d.delay,
                        ssrc: packet.d.ssrc
                    },
                    seq: packet.d.seq
                };
                return;
            }

            /**
             * @description Если получен код о необходимости ответа сервера
             * @private
             * @code 8
             */
            case VoiceOpcodes.Hello: {
                // Задаем время жизни голосового подключения
                if (this.state.code !== VoiceSocketStatusCode.close && packet.d.heartbeat_interval) this.state.ws.keepAlive = packet.d.heartbeat_interval;

                return;
            }

            /**
             * @description Если получен код о ...
             * @private
             * @code 9
             */
            case VoiceOpcodes.Resumed: {
                if (this.state.code !== VoiceSocketStatusCode.resume) return;

                this.state = {...this.state, code: VoiceSocketStatusCode.ready};
                this.state.connectionData.speaking = false;
                return;
            }
        }
    };

    /**
     * @description Распространяет ошибки из дочернего голосового веб-сокета и голосового UDP-сокета.
     * @param error - Ошибка, которая была выдана дочерним элементом
     * @private
     */
    private emitError = (error: Error) => {
        this.emit("error", error);
    };

    /**
     * @description Вызывается, когда UDP-сокет сам закрылся, если он перестал получать ответы от Discord.
     * @private
     */
    private SocketUDPClose = () => {
        // Если статус код не соответствует с VoiceSocketStatusCode.ready
        if (this.state.code !== VoiceSocketStatusCode.ready) return;

        this.state = { ...this.state,
            ws: this.createWebSocket(this.state.connectionOptions.endpoint),
            code: VoiceSocketStatusCode.resume
        };
    };

    /**
     * @description Уничтожает сетевой экземпляр, переводя его в закрытое состояние.
     * @public
     */
    public destroy = () => {
        this.removeAllListeners();

        // Удаляем данные в следующем цикле
        setImmediate(() => {
            this.state = { code: VoiceSocketStatusCode.close };
            for (let key of Object.keys(this)) this[key] = null;
        });
    };
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
        udp: SocketUDP;
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