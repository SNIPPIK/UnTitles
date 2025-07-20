import { WebSocketOpcodes, GatewayCloseCodes } from "#service/voice";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { HeartbeatManager } from "../managers/heartbeat";
import { WebSocket, MessageEvent } from "ws";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Клиент для подключения к WebSocket
 * @class ClientWebSocket
 * @extends TypedEmitter
 * @public
 */
export class ClientWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    /** Конечная точка подключения */
    private endpoint: string;

    /** Параметр подключения */
    private isConnecting: boolean;

    /** Менеджер жизни подключения, необходим для работы подключения */
    private heartbeat: HeartbeatManager;

    /** Клиент WebSocket */
    private ws: WebSocket;

    /** Номер последнего принятого пакета */
    public lastAsk: number = -1;

    /**
     * @description Подключен ли websocket к endpoint
     * @returns boolean
     * @public
     */
    public get connected() {
        return this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING;
    };

    /**
     * @description Отправляем пакет для работы discord
     * @param payload - Данные Discord Voice Opcodes
     * @public
     */
    public set packet(payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes | Buffer) {
        // Для отладки
        this.emit("debug", `[WebSocket/send:]`, payload);

        // Если ws не подключен
        if (!this.connected) return;

        try {
            if (payload instanceof Buffer) this.ws.send(payload);
            else this.ws.send(JSON.stringify(payload));
        } catch (err) {
            // Если ws упал
            if (`${err}`.match(/Cannot read properties of null/)) {
                // Пробуем подключится заново
                this.connect(this.endpoint);
                return;
            }

            this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
    };

    /**
     * @description Реализуем внутренние системы класса для подключения
     * @public
     */
    public constructor() {
        super();
        // Создаем менеджер жизни
        this.heartbeat = new HeartbeatManager({
            // Отправка heartbeat
            send: () => {
                this.packet = {
                    op: VoiceOpcodes.Heartbeat,
                    d: {
                        t: Date.now(),
                        seq_ack: this.lastAsk
                    }
                };
            },

            // Если не получен HEARTBEAT_ACK вовремя
            onTimeout: () => {
                if (this.heartbeat.missed >= 3) {
                    this.emit("warn", "HEARTBEAT_ACK timeout x3, reconnecting...");
                    this.attemptReconnect();
                } else {
                    this.emit("warn", "HEARTBEAT_ACK not received in time");
                }
            },

            // Получен HEARTBEAT_ACK
            onAck: (latency) => {
                //this.lastAsk++;
                this.emit("warn", `HEARTBEAT_ACK received. Latency: ${latency} ms`);
            }
        });
    };

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @param endpoint - Путь подключения
     * @returns void
     * @public
     */
    public connect = (endpoint: string): void => {
        if (this.isConnecting) return;
        this.isConnecting = true;

        // Если есть прошлый WS
        if (this.ws) this.reset();

        this.endpoint = endpoint;
        this.ws = new WebSocket(`${endpoint}?v=8`, {
            headers: {
                "User-Agent": "VoiceClient (https://github.com/SNIPPIK/UnTitles/tree/beta/src/services/voice)"
            }
        });

        // Сообщение от websocket соединения
        this.ws.onmessage = this.onEventMessage;

        // Запуск websocket соединения
        this.ws.onopen = () => {
            this.isConnecting = false;
            this.emit("open");
        }

        // Закрытие websocket соединения
        this.ws.onclose = (ev) => {
            this.isConnecting = false;
            this.onEventClose(ev.code, ev.reason);
        }

        // Ошибка websocket соединения
        this.ws.onerror = ({error}) => {
            this.isConnecting = false;
            this.emit("warn", error);

            // Если ws уже разорвал соединение
            if (`${error}`.match(/cloused before the connection/)) {
                this.emit("close", 4006, "WebSocket has over destroyed: Repeat!");
                return;
            }

            // Если ws разорвал соединение из-за слишком долгого ответа от рукопожатия
            else if (`${error}`.match(/handshake has timed out/)) {
                this.destroy();
                return;
            }

            this.emit("error", error);
        }
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в buffer
     * @returns void
     * @private
     */
    private onEventMessage = (data: MessageEvent): void => {
        if (data.data instanceof Buffer || data.data instanceof ArrayBuffer) {
            const buffer = data.data instanceof ArrayBuffer ? Buffer.from(data.data) : data.data;
            const op = buffer.readUInt8(2) as any;
            const payload = buffer.subarray(3);
            const seq = buffer.readUInt16BE(0);

            // Если есть последний seq
            if (seq) this.lastAsk = seq;

            this.emit("binary", { op, payload });
            return;
        }

        let payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        try {
            payload = JSON.parse(data.data.toString()) as WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        } catch {
            this.emit("error", new Error('Invalid JSON'));
            return;
        }

        // Если есть последний seq
        if ("seq" in payload) this.lastAsk = payload.seq;

        // Данные из пакета
        const { op, d } = payload;

        // Внутрення обработка
        switch (op) {
            // Проверка HeartbeatAck
            case VoiceOpcodes.HeartbeatAck: {
                this.heartbeat.ack();
                break;
            }

            // Проверка переподключения
            case VoiceOpcodes.Resumed: {
                this.heartbeat.start();
                break;
            }

            // Получение heartbeat_interval
            case VoiceOpcodes.Hello: {
                this.heartbeat.start(d["heartbeat_interval"]);
                break;
            }

            // Проверка подключения клиента
            case VoiceOpcodes.Speaking: {
                this.emit("speaking", payload as any);
                break;
            }

            // Проверка подключения клиента
            case VoiceOpcodes.ClientsConnect: {
                this.emit("ClientConnect", payload);
                break;
            }

            // Проверка отключения клиента
            case VoiceOpcodes.ClientDisconnect: {
                this.emit("ClientDisconnect", payload);
                break;
            }

            // Получение статуса готовности
            case VoiceOpcodes.Ready: {
                this.emit("ready", payload);
                this.heartbeat.resetReconnects(); // Сбросить счётчик при успешном подключении
                break;
            }

            // Получение статуса о данных сессии
            case VoiceOpcodes.SessionDescription: {
                this.emit("sessionDescription", payload);
                break;
            }

            // Dave
            case VoiceOpcodes.DaveMlsCommitWelcome:
            case VoiceOpcodes.DaveTransitionReady:
            case VoiceOpcodes.DaveMlsWelcome:
            case VoiceOpcodes.DavePrepareEpoch:
            case VoiceOpcodes.DaveMlsKeyPackage:
            case VoiceOpcodes.DaveMlsInvalidCommitWelcome:
            case VoiceOpcodes.DaveMlsProposals:
            case VoiceOpcodes.DaveMlsExternalSender:
            case VoiceOpcodes.DaveExecuteTransition:
            case VoiceOpcodes.DaveMlsAnnounceCommitTransition:
            case VoiceOpcodes.DavePrepareTransition: {
                this.emit("daveSession", payload);
                break;
            }
        }

        // Для отладки
        this.emit("debug", `[WebSocket/get:]`, payload);
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param code - Код закрытия
     * @param reason - Причина закрытия
     * @returns void
     * @private
     */
    private onEventClose = (code: GatewayCloseCodes, reason: string): void => {
        const ignoreCodes: GatewayCloseCodes[] = [4014, 4022];
        const notReconnect: GatewayCloseCodes[] = [4006, 1000, 1002];

        this.emit("debug", `[WebSocket/close]: ${code} - ${reason}`);

        // Если получен игнорируемый код
        if (ignoreCodes.includes(code)) return;

        // Если ws был подключен до отключения
        else if (this.connected && !notReconnect.includes(code)) {
            // Если можно подключится заново создавая новой ws
            if (code < 4000 || code === 4015) {
                this.attemptReconnect();
                return;
            }
        }

        // Отправляем данные в TypedEmitter
        this.emit("close", code, reason);
    };

    /**
     * @description Проверяем кол-во переподключений
     * @returns void
     * @private
     */
    private attemptReconnect = (reconnect?: boolean): void => {
        this.heartbeat.stop();

        // Переподключемся минуя посредика в виде VoiceConnection
        if (reconnect || this.heartbeat.reconnectAttempts >= 3) {
            this.emit("debug", `Reconnecting...`);
            this.connect(this.endpoint);
            return;
        }

        this.heartbeat.increaseReconnect();
        const delay = Math.min(1000 * this.heartbeat.reconnectAttempts, 5000);

        // Переподключемся через код resume
        setTimeout(() => {
            this.emit("debug", `Reconnecting... Attempt ${this.heartbeat.reconnectAttempts}`);
            this.emit("resumed");
        }, delay);
    };

    /**
     * @description Отключение текущего websocket подключения
     * @returns void
     * @public
     */
    public reset = (): void => {
        // Если есть websocket клиент
        if (this.ws) {
            this.removeAllListeners();

            if (this.connected) this.ws.close(1_000);
        }

        this.ws = null;
        this.lastAsk = -1;
        this.heartbeat.stop();
    };

    /**
     * @description Уничтожаем подключение
     * @returns void
     * @public
     */
    public destroy = (): void => {
        this.reset();
        this.lastAsk = null;
    };
}

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
 * @interface ClientWebSocketEvents
 */
interface ClientWebSocketEvents {
    /**
     * @description Если произошла ошибка
     * @param err - Сама ошибка
     */
    "error": (err: Error) => void;

    /**
     * @description Если получен код выключения от discord
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "close": (code: GatewayCloseCodes, reason: string) => void;

    /**
     * @description Если получен код голоса от discord, нужен для receiver
     */
    "speaking": (d: WebSocketOpcodes.speaking_get) => void;

    /**
     * @description Если получен код подключения нового клиента
     * @constructor
     */
    "ClientConnect": (d: WebSocketOpcodes.connect) => void;

    /**
     * @description Если получен код отключения клиента
     * @constructor
     */
    "ClientDisconnect": (d: WebSocketOpcodes.disconnect) => void;

    /**
     * @description Если клиент был отключен из-за отключения бота от голосового канала
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "disconnect": (code: number, reason: string) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "ready": (opcodes: WebSocketOpcodes.ready) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "sessionDescription": (opcodes: WebSocketOpcodes.session) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "daveSession": (opcodes: WebSocketOpcodes.dave_opcodes) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "binary": (data: {op: WebSocketOpcodes.dave_opcodes["op"], payload: Buffer}) => void;

    /**
     * @description Успешное подключение WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Identify,
     *     d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          user_id: this.voiceState.user_id,
     *          token: this.serverState.token
     * }
     * ```
     */
    "open": () => void;

    /**
     * @description Требуется для переподключения WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Resume,
     *    d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          token: this.serverState.token,
     *          seq_ack: this.websocket.lastAsk
     * }
     * ```
     */
    "resumed": () => void;
}