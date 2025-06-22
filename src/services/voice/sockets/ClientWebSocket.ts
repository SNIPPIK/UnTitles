import { HeartbeatManager } from "../managers/heartbeat";
import { VoiceOpcodes } from "discord-api-types/voice";
import { TypedEmitter } from "#structures";
import { WebSocket, Data } from "ws";

/**
 * @author SNIPPIK
 * @description Клиент для подключения к WebSocket
 * @class ClientWebSocket
 * @extends TypedEmitter
 * @public
 */
export class ClientWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    /** Конечная точко подключения */
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
    public set packet(payload: opcode.extract) {
        // Если ws не подключен
        if (!this.connected) {
            this.emit("warn", `Failed send packet\n - ${payload}`);
            return;
        }

        try {
           this.ws.send(JSON.stringify(payload));
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
                if (this.heartbeat.missed >= 2) {
                    this.emit("warn", "HEARTBEAT_ACK timeout x2, reconnecting...");
                    this.attemptReconnect();
                } else {
                    this.emit("warn", "HEARTBEAT_ACK not received in time");
                }
            },

            // Получен HEARTBEAT_ACK
            onAck: (latency) => {
                this.lastAsk++;
                this.emit("debug", `HEARTBEAT_ACK received. Latency: ${latency} ms`);
                if (this.ws?.readyState === WebSocket.OPEN) this.ws.ping();
            }
        });
    }

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @param endpoint - Путь подключения
     * @public
     */
    public connect = (endpoint: string) => {
        if (this.isConnecting) return;
        this.isConnecting = true;

        // Если есть прошлый WS
        if (this.ws) this.reset();

        this.endpoint = endpoint;
        this.ws = new WebSocket(endpoint, {
            handshakeTimeout: 5e3,
            sessionTimeout: 5e3,
            headers: {
                "User-Agent": "VoiceClient (https://github.com/SNIPPIK/UnTitles/tree/beta/src/services/voice)"
            }
        });

        // Сообщение от websocket соединения
        this.ws.on("message", this.onEventMessage);

        // Запуск websocket соединения
        this.ws.on("open", () => {
            this.isConnecting = false;
            this.emit("open");
        });

        // Закрытие websocket соединения
        this.ws.on("close", (code, reason) => {
            this.isConnecting = false;
            this.onEventClose(code, reason as any);
        });

        // Ошибка websocket соединения
        this.ws.once("error", (err) => {
            this.isConnecting = false;
            this.emit("warn", err);

            // Если ws уже разорвал соединение
            if (`${err}`.match(/cloused before the connection/)) {
                this.emit("close", 4006, "WebSocket has over destroyed: Repeat!");
                return;
            }

            // Если ws разорвал соединение из-за слишком долгого ответа от рукопожатия
            else if (`${err}`.match(/handshake has timed out/)) {
                this.destroy();
                return;
            }

            this.emit("error", err);
        });
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в buffer
     * @private
     */
    private onEventMessage = (data: Data) => {
        let payload: opcode.extract;
        try {
            payload = JSON.parse(data.toString());
        } catch {
            this.emit("error", new Error('Invalid JSON'));
            return;
        }

        // Данные из пакета
        const { op, d } = payload;

        // Внутрення обработка
        switch (op) {
            // Получение heartbeat_interval
            case VoiceOpcodes.Hello: {
                this.heartbeat.start(d.heartbeat_interval);
                break;
            }

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

            // Проверка отключения клиента
            case VoiceOpcodes.ClientDisconnect: {
                this.emit("disconnect", d.code, d.reason);
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
        }

        // Для отладки
        this.emit("debug", payload);
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param code - Код закрытия
     * @param reason - Причина закрытия
     */
    private onEventClose = (code: WebSocketCloseCodes, reason: string) => {
        const ignoreCodes: WebSocketCloseCodes[] = [4014, 4022];

        this.emit("debug", `WS Close: ${code} - ${reason}`);

        // Если получен игнорируемый код
        if (ignoreCodes.includes(code)) return;

        // Если ws был подключен до отключения
        if (this.connected) {
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
     * @private
     */
    private attemptReconnect = (reconnect?: boolean) => {
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
     * @public
     */
    public reset = () => {
        this.emit("debug", "[WS] reset requested");

        // Если есть websocket клиент
        if (this.ws) {
            this.removeAllListeners();
            this.ws.removeAllListeners();

            if (this.connected) this.ws.close(1_000);
            this.ws = null;
        }

        this.lastAsk = -1;
        this.heartbeat.stop();
    };

    /**
     * @description Уничтожаем подключение
     * @public
     */
    public destroy = () => {
        this.removeAllListeners();
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
    "close": (code: WebSocketCloseCodes, reason: string) => void;

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
    "ready": (opcodes: opcode.ready) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "sessionDescription": (opcodes: opcode.session) => void;

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

/**
 * @author SNIPPIK
 * @description Поддерживаемые коды
 * @namespace opcode
 */
export namespace opcode {
    /**
     * @description Все opcode, для типизации websocket
     * @type extract
     */
    export type extract = identify | select_protocol | ready | heartbeat | session | speaking | heartbeat_ask | resume | hello | resumed | disconnect;

    /**
     * @description Данные для подключения именно к голосовому каналу
     * @usage only-send
     * @code 0
     */
    export interface identify {
        "op": VoiceOpcodes.Identify;
        "d": {
            "server_id": string;
            "user_id": string;
            "session_id": string;
            "token": string;
        }
    }

    /**
     * @description Данные для создания UDP подключения
     * @usage only-send
     * @code 1
     */
    export interface select_protocol {
        "op": VoiceOpcodes.SelectProtocol;
        "d": {
            "protocol": "udp", // Протокол подключения
            "data": {
                "address": string
                "port": number
                "mode": string
            }
        }
    }

    /**
     * @description Данные для создания RTP подключения
     * @usage only-request
     * @code 2
     */
    export interface ready {
        "op": VoiceOpcodes.Ready;
        "d": {
            "ssrc": number;
            "ip": string;
            "port": number;
            "modes": string[];
            "heartbeat_interval": number;
        }
        "s": number
    }

    /**
     * @description Данные для подтверждения работоспособности подключения
     * @usage only-send
     * @code 3
     */
    export interface heartbeat {
        "op": VoiceOpcodes.Heartbeat;
        "d": {
            "t": number;
            "seq_ack": number;
        }
    }

    /**
     * @description Данные для создания RTP подключения
     * @usage only-request
     * @code 4
     */
    export interface session {
        "op": VoiceOpcodes.SessionDescription;
        "d": {
            mode: string;         // Выбранный режим шифрования, например "xsalsa20_poly1305"
            secret_key: number[]; // Массив байтов (uint8) для шифрования RTP-пакетов
        };
    }

    /**
     * @description Данные для начала возможности отправки пакетов через UDP
     * @usage only-send
     * @code 5
     */
    export interface speaking {
        "op": VoiceOpcodes.Speaking,
        "seq": number;
        "d": {
            "speaking": number;
            "delay": number;
            "ssrc": number;
        }
    }

    /**
     * @description Данные для обновления жизненного цикла websocket
     * @usage only-request
     * @code 6
     */
    export interface heartbeat_ask {
        "op": VoiceOpcodes.HeartbeatAck,
        "d": {
            "t": number
        }
    }

    /**
     * @description Данные для обновления жизненного цикла websocket
     * @usage only-request
     * @code 7
     */
    export interface resume {
        "op": VoiceOpcodes.Resume;
        "d": {
            "server_id": string;
            "session_id": string;
            "token": string;
            "seq_ack": number;
        }
    }

    /**
     * @description Данные для обновления жизненного цикла websocket
     * @usage only-request
     * @code 8
     */
    export interface hello {
        "op": VoiceOpcodes.Hello;
        "d": {
            "heartbeat_interval": number;
        }
    }

    /**
     * @description Данные для обновления websocket
     * @usage only-request
     * @code 9
     */
    export interface resumed {
        "op": VoiceOpcodes.Resumed;
        "d": {};
    }

    /**
     * @description Данные для отключения бота от голосового канала
     * @usage send/request
     * @code 13
     */
    export interface disconnect {
        "op": VoiceOpcodes.ClientDisconnect;
        "d": {
            "code": number;
            "reason": string;
        }
    }
}

/**
 * @author SNIPPIK
 * @description Статус коды, Discord Gateway WebSocket
 * @enum WebSocketCloseCodes
 */
export enum WebSocketCloseCodes {
    /** 1000 - Нормальное завершение соединения. */
    NORMAL_CLOSURE = 1000,

    /** 1001 - Соединение закрыто, т.к, сервер или клиент отключается. */
    GOING_AWAY = 1001,

    /** 1006 - Аномальное закрытие, соединение было закрыто без фрейма закрытия. */
    ABNORMAL_CLOSURE = 1006,

    // Discord Specific Codes

    /** 4001 - Неизвестный opcode или некорректный payload. */
    UNKNOWN_OPCODE = 4001,

    /** 4002 - Некорректная структура payload. */
    DECODE_ERROR = 4002,

    /** 4003 - Не авторизован. */
    NOT_AUTHENTICATED = 4003,

    /** 4004 - Недействительный токен авторизации. */
    AUTHENTICATION_FAILED = 4004,

    /** 4005 - Уже авторизован. */
    ALREADY_AUTHENTICATED = 4005,

    /** 4006 - Сессия больше не действительна */
    INVALID_SESSION = 4006,

    /** 4009 - Истечение времени сеанса */
    SESSION_TIMEOUT = 4009,

    /** 4011 - Сервер не найден  */
    SHARDING_REQUIRED = 4011,

    /** 4012 - Неизвестный протокол */
    INVALID_VERSION = 4012,

    /** 4014 - Отключен */
    DISALLOWED_INTENTS = 4014,

    /** 4015 - Голосовой сервер вышел из строя */
    INSUFFICIENT_RESOURCES = 4015,

    /** 4016 - Неизвестный режим шифрования */
    OVERLOADED = 4016,

    /** 4016 - Плохой запрос  */
    BAD_REQUEST = 4020,

    /** 4022 - Сессия устарела  */
    Session_Expired = 4022
}