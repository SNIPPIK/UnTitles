import { VoiceOpcodes } from "discord-api-types/voice";
import { TypedEmitter } from "#structures/emitter";
import { WebSocket, Data } from "ws";

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
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
    "packet": (opcodes: opcode.exported) => void;

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
    "connect": () => void;

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
    "request_resume": () => void;
}

/**
 * @author SNIPPIK
 * @description Статусы подключений websocket
 * @enum WebSocketStatuses
 */
enum WebSocketStatuses {
    // Если подключение полностью готово
    ready = "ready",

    // Если производится подключение
    connecting = "connecting",

    // Если подключение разорвано
    close = "close"
}

/**
 * @author SNIPPIK
 * @description Клиент для подключения к WebSocket
 * @class ClientWebSocket
 * @extends TypedEmitter
 * @public
 */
export class ClientWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    private _status = WebSocketStatuses.connecting;
    private ws: WebSocket;

    /**
     * @description Данные для проверки жизни websocket
     * @private
     */
    private readonly heartbeat = {
        interval: null as NodeJS.Timeout,
        timeout: null as NodeJS.Timeout,
        intervalMs: null as number,
        timeoutMs: 5e3,
        reconnects: 0,

        miss: 0
    };

    /**
     * @description Номер последнего принятого пакета
     * @public
     */
    public lastAsk: number = 0;

    /**
     * @description Получаем статус websocket
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
    public set packet(payload: opcode.extract) {
        if (this.status === WebSocketStatuses.ready) {
            try {
                this.ws.send(JSON.stringify(payload));
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
        if (this.ws) this.cleanupWebSocket();

        this.ws = new WebSocket(this.endpoint, {
            handshakeTimeout: 7e3,
            sessionTimeout: 5e3,
            headers: {
                "User-Agent": "VoiceClient (https://github.com/SNIPPIK/UnTitles/tree/beta/src/services/voice)"
            }
        });

        // Сообщение от ws
        this.ws.on("message", this.onEventMessage);

        // Закрытие ws
        this.ws.on("close",  this.onEventClose);

        // Ошибка ws
        this.ws.on("error",  err  => this.emit("error", err));

        // Запуск ws
        this.ws.on("open",   () => {
            this._status = WebSocketStatuses.ready;
            this.emit("connect");
        });
    };

    /**
     * @description Уничтожаем подключение
     * @public
     */
    public destroy = () => {
        this.cleanupWebSocket();
        this.removeAllListeners();

        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);
        if (this.heartbeat.interval) clearTimeout(this.heartbeat.interval);
    };

    /**
     * @description Функция уничтожения подключения
     * @private
     */
    private cleanupWebSocket = () => {
        this.ws?.removeAllListeners();

        // Проверяем на готовность
        if (this.ws && this.ws?.readyState === WebSocket.OPEN) {
            this.ws?.close(1000);
            this.emit("close", 1000, "Normal closing");
        }

        this.ws?.terminate();
        this.ws = null;
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
                this.manageHeartbeat(d.heartbeat_interval);
                this.heartbeat.intervalMs = d.heartbeat_interval;
                break;
            }

            // Проверка HeartbeatAck
            case VoiceOpcodes.HeartbeatAck: {
                this.lastAsk++;
                this.handleHeartbeatAck(d.t);
                break;
            }

            // Проверка переподключения
            case VoiceOpcodes.Resumed: {
                this.heartbeat.reconnects = 0;
                this.manageHeartbeat();
                break;
            }

            // Проверка отключения клиента
            case VoiceOpcodes.ClientDisconnect: {
                this.emit("disconnect", d.code, d.reason);
                break;
            }

            // Получение статуса готовности
            case VoiceOpcodes.Ready: {
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
    private onEventClose = (code: WebSocketCloseCodes, reason: string) => {
        const recreateCodes: WebSocketCloseCodes[] = [1006];

        this.emit("debug", `WS Close: ${code} - ${reason}`);

        // Если ws был подключен до отключения
        if (this._status === WebSocketStatuses.ready) {
            // Если заново подключится не выйдет
            if (recreateCodes.includes(code)) {
                this.attemptReconnect(true);
                return;
            }

            // Если можно подключится заново создавая новой ws
            else if (code < 4000 || code === 4015) {
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
     * @description Если ответ от websocket не получен то пересоздадим подключение
     * @private
     */
    private startHeartbeatTimeout = () => {
        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);

        // Запускаем таймер
        this.heartbeat.timeout = setTimeout(() => {
            // Если кол-во пропущенных ответ >=2, то подключаемся заново
            if (this.heartbeat.miss >= 2) this.attemptReconnect(false);

            this.emit("warn", "HEARTBEAT_ACK not received within timeout");
            this.heartbeat.miss++;
        }, this.heartbeat.timeoutMs);
    };

    /**
     * @description Управление состоянием heartbeat websocket'а
     * @param intervalMs - Время в мс
     * @private
     */
    private manageHeartbeat(intervalMs?: number) {
        if (this.heartbeat.interval) clearInterval(this.heartbeat.interval);
        if (intervalMs !== 0) this.heartbeat.intervalMs = intervalMs;

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
        this.heartbeat.miss = 0;

        if (this.heartbeat.timeout) {
            clearTimeout(this.heartbeat.timeout);
            this.heartbeat.timeout = null;
        }
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
}