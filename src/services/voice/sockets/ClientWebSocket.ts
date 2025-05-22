import {VoiceOpcodes} from "discord-api-types/voice";
import {TypedEmitter} from "@utils";
import {WebSocket, Data} from "ws";

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
 */
interface ClientWebSocketEvents {
    "error": (err: Error) => void;
    "close": (code: WebSocketCloseCodes, reason: string) => void;
    "disconnect": (code: number, reason: string) => void;

    /**
     * @description Успешное подключение WebSocket
     */
    "connect": () => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param full - Все opcode
     */
    "packet": (full: opcode.exported) => void;

    /**
     * @description Требуется для переподключения WebSocket
     */
    "request_resume": () => void;
}

/**
 * @author SNIPPIK
 * @description Клиент для подключения к WebSocket
 * @class ClientWebSocket
 */
export class ClientWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    /**
     * @description WebSocket клиент для общения с точкой подключения
     * @private
     */
    private _client: WebSocket;

    /**
     * @description Данные для проверки жизни websocket
     * @private
     */
    private readonly heartbeat = {
        interval: null as NodeJS.Timeout,
        timeout: null as NodeJS.Timeout,
        intervalMs: null as number,
        timeoutMs: 5e3,
        reconnects: 0
    };

    /**
     * @description Фрагмент IP Discovery
     * @public
     */
    public ssrc: number;

    /**
     * @description Номер последнего принятого пакета
     * @public
     */
    public lastAsk: number = 0;

    /**
     * @description Статус готовности подключения
     * @public
     */
    public get ready() {
        return !!this._client && this._client.readyState === WebSocket.OPEN;
    };

    /**
     * @description Отправляем пакет для работы discord
     * @param payload - Данные Discord Voice Opcodes
     * @public
     */
    public set packet(payload: opcode.extract) {
        if (this._client.readyState === WebSocket.OPEN) {
            try {
                this._client.send(JSON.stringify(payload));
            } catch (e) {
                this.emit("error", new Error(`${e}`));
            }
        }
    };

    /**
     * @description Создаем класс
     * @param endpoint - Путь подключения
     */
    public constructor(private readonly endpoint: string) {
        super();
    };

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @public
     */
    public connect = () => {
        // Если есть прошлый WS
        if (this._client) {
            this._client.close(1000);
            this._client.terminate();
            this._client.removeAllListeners();
        }

        this._client = new WebSocket(this.endpoint, {
            headers: {
                "User-Agent": "VoiceClient (https://github.com/SNIPPIK/UnTitles/tree/beta/src/services/voice)"
            }
        });
        this._client.on("open",   () => this.emit("connect"));
        this._client.on("message", this.onMessage);
        this._client.on("close",  this.onClose);
        this._client.on("error",  err  => this.emit("error", err));
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в buffer
     * @private
     */
    private onMessage = (data: Data) => {
        let payload: opcode.extract;
        try {
            payload = JSON.parse(data.toString());
        } catch {
            this.emit("error", new Error('Invalid JSON'));
            return;
        }

        const { op, d } = payload;

        // Внутрення обработка
        switch (op) {
            case VoiceOpcodes.Hello: {
                this.lastAsk++;
                this.manageHeartbeat(d.heartbeat_interval);
                this.heartbeat.intervalMs = d.heartbeat_interval;
                break;
            }

            case VoiceOpcodes.HeartbeatAck: {
                this.handleHeartbeatAck(d.t);
                break;
            }

            case VoiceOpcodes.Resumed: {
                this.heartbeat.reconnects = 0;
                this.manageHeartbeat();
                break;
            }

            case VoiceOpcodes.ClientDisconnect: {
                this.emit("disconnect", d.code, d.reason);
                this.attemptReconnect();
                break;
            }

            case VoiceOpcodes.Ready: {
                this.ssrc = d.ssrc;
                this.emit("packet", payload);
                this.heartbeat.reconnects = 0; // Сбросить счётчик при успешном подключении
                break;
            }

            default: this.emit("packet", payload);
        }

        // Для отладки
        this.emit("debug", payload);
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param code - Код закрытия
     * @param reason - Причина закрытия
     */
    private onClose = (code: WebSocketCloseCodes, reason: Buffer) => {
        const error = reason.toString();

        const noReconnectCodes = [1000, 1003, 1007, 1008, 1009, 1010, 4001, 4002, 4004, 4005, 4013];
        const reconnectCodes = [1001, 1006, 1011, 1012, 1013, 1015, 4000, 4006, 4009, 4011, 4014];

        if (noReconnectCodes.includes(code)) {
            this.emit("debug", `[${code}] ${reason}. Not reconnecting.`);
            this.emit("close", 1000, error);
            return;
        }

        if (reconnectCodes.includes(code) || code >= 4000) {
            this.emit("debug", `[${code}] ${reason}. Reconnecting...`);
            this.attemptReconnect();
            return;
        }

        // По умолчанию — переподключаемся
        this.emit("debug", `[${code}] ${reason}. Reconnecting by default...`);
        this.emit("close", code, error);
    };

    /**
     * @description Проверяем кол-во переподключений
     * @private
     */
    private attemptReconnect = (reconnect?: boolean) => {
        if (this.heartbeat.interval) clearInterval(this.heartbeat.interval);
        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);

        if (reconnect || this.heartbeat.reconnects >= 3) {
            this.emit("debug", `Reconnecting...`);
            this.connect();
            return;
        }

        this.heartbeat.reconnects++;
        const delay = Math.min(1000 * this.heartbeat.reconnects, 5000);

        setTimeout(() => {
            this.emit("debug", `Reconnecting... Attempt ${this.heartbeat.reconnects}`);
            this.emit("request_resume");
        }, delay);
    };

    /**
     * @description Управление состоянием heartbeat websocket'а
     * @param intervalMs - Время в мс
     * @private
     */
    private manageHeartbeat(intervalMs?: number) {
        if (this.heartbeat.interval) clearInterval(this.heartbeat.interval);
        if (intervalMs) this.heartbeat.intervalMs = intervalMs;

        this.heartbeat.interval = setInterval(() => {
            this.packet = {
                op: VoiceOpcodes.Heartbeat,
                d: {
                    t: Date.now(),
                    seq_ack: this.lastAsk
                }
            };

            this.startHeartbeatTimeout();
        }, this.heartbeat.intervalMs);
    };

    /**
     * @description Если получен ответ от циклической системы discord
     * @param ackData - Полученное время
     * @private
     */
    private handleHeartbeatAck = (ackData: number) => {
        this.emit("debug", `HEARTBEAT_ACK received. Latency: ${Date.now() - ackData} ms`);

        if (this.heartbeat.timeout) {
            clearTimeout(this.heartbeat.timeout);
            this.heartbeat.timeout = null;
        }
    };

    /**
     * @description Если ответ от websocket не получен то пересоздадим подключение
     * @private
     */
    private startHeartbeatTimeout = () => {
        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);

        this.heartbeat.timeout = setTimeout(() => {
            this.emit("warn", "HEARTBEAT_ACK not received within timeout. Reconnecting...");
            this.attemptReconnect();
        }, this.heartbeat.timeoutMs);
    };

    /**
     * @description Уничтожаем подключение
     * @public
     */
    public destroy = () => {
        // Проверяем на готовность
        if (this.ready) this._client.close(1000);

        this.removeAllListeners();
        this._client.removeAllListeners();
        this._client.terminate();
        this._client = null;

        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);
        if (this.heartbeat.interval) clearTimeout(this.heartbeat.interval);
    };
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
     * @description Opcodes, эти коды выходят из события packet
     */
    export type exported = identify | select_protocol | ready | heartbeat | session | speaking | resume;

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
        op: VoiceOpcodes.SessionDescription;
        d: {
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
        op: VoiceOpcodes.Resumed;
        d: {};
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

    /** 1001 - Соединение закрыто, т.к. сервер или клиент отключается. */
    GOING_AWAY = 1001,

    /** 1002 - Соединение закрыто из-за ошибки протокола. */
    PROTOCOL_ERROR = 1002,

    /** 1003 - Соединение закрыто из-за получения неподдерживаемого типа данных. */
    UNSUPPORTED_DATA = 1003,

    /** 1004 - Зарезервировано. */
    RESERVED = 1004,

    /** 1005 - Статус закрытия не был предоставлен. */
    NO_STATUS_RECEIVED = 1005,

    /** 1006 - Аномальное закрытие, соединение было закрыто без фрейма закрытия. */
    ABNORMAL_CLOSURE = 1006,

    /** 1007 - Соединение закрыто из-за получения некорректных данных. */
    INVALID_PAYLOAD = 1007,

    /** 1008 - Соединение закрыто из-за нарушения политики. */
    POLICY_VIOLATION = 1008,

    /** 1009 - Сообщение слишком большое для обработки. */
    MESSAGE_TOO_BIG = 1009,

    /** 1010 - Клиент закрыл соединение для согласования расширений. */
    MISSING_EXTENSION = 1010,

    /** 1011 - Внутренняя ошибка сервера. */
    INTERNAL_ERROR = 1011,

    /** 1012 - Сервис перезапускается. */
    SERVICE_RESTART = 1012,

    /** 1013 - Попробуйте позже. */
    TRY_AGAIN_LATER = 1013,

    // Discord Specific Codes

    /** 4000 - Неизвестная ошибка. Попробуйте переподключиться. */
    UNKNOWN_ERROR = 4000,

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

    /** 4006 - Недействительная сессия. */
    INVALID_SESSION = 4006,

    /** 4007 - Неверный sequence номер при восстановлении сессии. */
    INVALID_SEQ = 4007,

    /** 4008 - Превышен лимит запросов. Переподключитесь через некоторое время. */
    RATE_LIMITED = 4008,

    /** 4009 - Сессия истекла. Необходимо начать новую. */
    SESSION_TIMEOUT = 4009,

    /** 4010 - Неверный shard. */
    INVALID_SHARD = 4010,

    /** 4011 - Необходимо шардирование, но оно не настроено. */
    SHARDING_REQUIRED = 4011,

    /** 4012 - Некорректная версия gateway. */
    INVALID_VERSION = 4012,

    /** 4013 - Некорректные intent(s). */
    INVALID_INTENTS = 4013,

    /** 4014 - Недопустимые intent(s). */
    DISALLOWED_INTENTS = 4014,

    /** 4015 - Соединение закрыто из-за нехватки ресурсов. */
    INSUFFICIENT_RESOURCES = 4015,

    /** 4016 - Соединение закрыто из-за перегрузки. */
    OVERLOADED = 4016,
}