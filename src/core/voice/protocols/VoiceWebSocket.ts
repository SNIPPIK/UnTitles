import { type WebSocketOpcodes, GatewayCloseCodes } from "#core/voice";
import { WebSocket, type MessageEvent, type Data } from "ws";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { HeartbeatManager } from "../managers/heartbeat";
import { Logger, TypedEmitter } from "#structures";
import { version, name } from "package.json";
import os from "node:os";

/**
 * @author SNIPPIK
 * @description Версия user agent для WebSocket
 * @const user_agent
 * @private
 */
const user_agent = `WTK Voice System (${os.arch()}; ${os.version()}) ${version}/${name}`;

/**
 * @author SNIPPIK
 * @description Игнорируемые коды закрытия от discord
 * @const GatewayCloseCodesIgnore
 * @private
 */
const GatewayCloseCodesIgnore: GatewayCloseCodes[] = [4014, 4022];

/**
 * @author SNIPPIK
 * @description Клиент для взаимодействия с discord, по методу wss
 * @class VoiceWebSocket
 * @extends TypedEmitter
 * @public
 */
export class VoiceWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    /**
     * @description Текущий статус подключения клиента
     * @private
     */
    private _status: WebSocketStatus = WebSocketStatus.idle;

    /**
     * @description Адрес для подключения по websocket
     * @private
     */
    private _endpoint: string;

    /**
     * @description Менеджер жизни подключения
     * @private
     */
    private _heartbeat: HeartbeatManager;

    /**
     * @description Клиент websocket secure
     * @private
     */
    private ws: WebSocket;

    /**
     * @description Последовательность запроса
     * @public
     */
    public sequence: number = -1;

    /**
     * @description Последняя зафиксированная задержка в ms
     * @public
     */
    public latency: number = null;
    private latencyArray: number[] = [];

    /**
     * @description Текущий статус клиента
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Отправляем пакет для работы discord
     * @param payload - Данные Discord Voice Opcodes
     * @public
     */
    public set packet(payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes | Buffer) {
        // Для отладки
        this.emit("debug", `[WebSocket/send]:`, payload);

        // Если ws клиент подключен
        if (this._status === "connected") {
            try {
                if (payload instanceof Buffer) this.ws.send(payload);
                else this.ws.send(JSON.stringify(payload));
            } catch (err) {
                // Если ws упал
                if (`${err}`.match(/Cannot read properties of null/)) {
                    // Пробуем подключится заново
                    this.connect(this._endpoint, 4001);
                    return;
                }

                this.emit("error", err instanceof Error ? err : new Error(String(err)));
            }
        }
    };

    /**
     * @description Реализуем внутренние системы класса для подключения
     * @public
     */
    public constructor() {
        super();
        // Создаем менеджер жизни
        this._heartbeat = new HeartbeatManager({
            // Отправка heartbeat
            send: () => {
                this.packet = {
                    op: VoiceOpcodes.Heartbeat,
                    d: {
                        t: Date.now(),
                        seq_ack: this.sequence
                    }
                };
            },

            // Если не получен HEARTBEAT_ACK вовремя
            onTimeout: () => {
                if (this._heartbeat.missed === 3) {
                    this._heartbeat.stop();

                    // Если текущий статус не является подключенным
                    if (this._status !== "connected") {
                        this.emit("close", 1001, "HEARTBEAT_ACK timeout");
                        this.emit("warn", "HEARTBEAT_ACK timeout x3, reconnecting...");
                    }
                } else {
                    this.emit("warn", "HEARTBEAT_ACK not received in time");
                }
            },

            // Получен HEARTBEAT_ACK
            onAck: (latency) => {
                /* Высчитываем задержку подключения */
                this.latencyArray.push(latency);
                if (this.latencyArray.length > 10) this.latencyArray.shift();

                let sum = 0;
                for (const v of this.latencyArray) sum += v;
                this.latency = parseInt((sum / this.latencyArray.length).toFixed(0));

                // Отправляем событие об ответе от websocket
                this.emit("warn", `HEARTBEAT_ACK received. Latency: ${latency} ms`);
            }
        });
    };

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @param endpoint - Путь подключения
     * @param code - Последний полученный код, нужен для понимания надо ли отправлять 7 opcode
     * @returns void
     * @public
     */
    public connect = (endpoint: string, code?: GatewayCloseCodes): void => {
        // Если ws уже подключается заново
        if (this._status === WebSocketStatus.connecting) return;

        // Меняем статус на подключение
        this._status = WebSocketStatus.connecting;

        // Если ws клиент уже есть
        if (this.ws) {
            if (code) Logger.log("DEBUG", `[WebSocket/${code}] has reset connection`);

            // Удаляем ws, поскольку он будет создан заново
            this.reset();
        }

        this._endpoint = endpoint;
        this.ws = new WebSocket(`wss://${endpoint}?v=8`, {
            headers: {
                "user-agent": user_agent
            }
        });

        // Сообщение от websocket соединения
        this.ws.onmessage = this.onReceiveMessage;

        // Запуск websocket соединения
        this.ws.onopen = () => {
            // Меняем статус на подключен
            this._status = WebSocketStatus.connected;
            this.emit("open");

            Logger.log("DEBUG", `[WebSocket] has open connection`);
        };

        // Закрытие websocket соединения
        this.ws.onclose = (ev) => {
            // Меняем статус на отключен
            this._status = WebSocketStatus.closed;
            this.onReceiveClose(ev.code, ev.reason);

            Logger.log("DEBUG", `[WebSocket] has close connection`);
        };

        // Ошибка websocket соединения
        this.ws.onerror = ({error}) => {
            // Меняем статус на переподключение
            this._status = WebSocketStatus.reconnecting;
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
        };
    };

    /**
     * @description Читаем буфер или json в виде строчки
     * @param data - Raw данные из websocket
     * @private
     */
    private readRawData = (data: Data) => {
        // Если пришел буфер
        if (data instanceof Buffer || data instanceof ArrayBuffer) {
            const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
            const op = buffer.readUInt8(2) as WebSocketOpcodes.dave_opcodes["op"];
            const payload = buffer.subarray(3);
            const sequence = buffer.readUInt16BE(0);

            // Если есть последний sequence
            if (sequence) this.sequence = sequence;

            // Отправляем полученный буфер
            this.emit("binary", { op, payload });

            // Для отладки
            this.emit("debug", `[WebSocket/get]:`, { op, sequence, payload: !!payload });
            return null;
        }

        // Если пришло json in string значение
        let payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        try {
            payload = JSON.parse(data.toString()) as WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        } catch {
            this.emit("error", new Error("Invalid JSON"));
            return null;
        }

        return payload;
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в buffer
     * @returns void
     * @private
     */
    private onReceiveMessage = (data: MessageEvent) => {
        const payload = this.readRawData(data.data);

        // Если нет данных
        if (!payload) return null;

        // Если есть последний seq
        if ("seq" in payload) this.sequence = payload.seq;

        // Данные из пакета
        const { op, d } = payload;

        // Внутрення обработка
        switch (op) {
            // Проверка HeartbeatAck
            case VoiceOpcodes.HeartbeatAck: {
                this._heartbeat.ack();
                break;
            }

            // Проверка переподключения
            case VoiceOpcodes.Resumed: {
                this._heartbeat.start();
                break;
            }

            // Получение heartbeat_interval
            case VoiceOpcodes.Hello: {
                this._heartbeat.start(d["heartbeat_interval"]);
                break;
            }

            // Проверка подключения клиента
            case VoiceOpcodes.Speaking: {
                this.emit("speaking", payload as any);
                break;
            }

            // Проверка подключения/отключения клиента
            case VoiceOpcodes.ClientDisconnect:
            case VoiceOpcodes.ClientsConnect: {
                this.emit("UsersRJC", payload);
                break;
            }

            // Получение статуса готовности
            case VoiceOpcodes.Ready: {
                this.emit("ready", payload);
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
        this.emit("debug", `[WebSocket/get]:`, payload);
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param code - Код закрытия
     * @param reason - Причина закрытия
     * @returns void
     * @private
     */
    private onReceiveClose = (code: GatewayCloseCodes, reason: string) => {
        this.emit("warn", `[WebSocket/close]: ${code} - ${reason}`);

        // Если получен игнорируемый код
        if (GatewayCloseCodesIgnore.includes(code)) return;

        // Отправляем данные в TypedEmitter
        this.emit("close", code, reason);
    };

    /**
     * @description Отключение текущего websocket подключения
     * @returns void
     * @public
     */
    public reset = (): void => {
        this.removeAllListeners();

        // Если есть websocket клиент
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();
            this.ws.terminate();
        }

        this.ws = null;
        this.latencyArray.length = 0;
        this.latencyArray = [];

        // Если есть менеджер жизни ws
        if (this._heartbeat) this._heartbeat.stop();
    };

    /**
     * @description Уничтожаем подключение
     * @returns void
     * @public
     */
    public destroy = (): void => {
        this.reset();
        super.destroy();
        this.sequence = null;
        this._endpoint = null;
        this._status = null;

        this.latencyArray = null;

        if (this._heartbeat) {
            this._heartbeat.destroy();
            this._heartbeat = null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Статусы для работы класса ClientWebSocket
 * @enum WebSocketStatus
 */
enum WebSocketStatus {
    /** Если клиент подключается заново  */
    reconnecting = "reconnecting",

    /** Если клиент подключается */
    connecting = "connecting",

    /** Если клиент подключен к серверу */
    connected = "connected",

    /** Если клиент закрыл соединение */
    closed = "closed",

    /** Если клиент просто ожидает дальнейших действий */
    idle = "idle"
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

    "warn": (text: string) => void;
    "debug": (state: string, text: any) => void;

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
     * @description Если добавлен новый пользователь или удален старый
     * @constructor
     */
    "UsersRJC": (d: WebSocketOpcodes.connect | WebSocketOpcodes.disconnect) => void;

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