import {VoiceOpcodes} from "discord-api-types/voice";
import {TypedEmitter} from "@utils";
import {WebSocket, Data} from "ws";

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
 */
export interface ClientWebSocketEvents {
    "error": (err: Error) => void;
    "close": (code: number) => void;


    "identified": (d: opcode.identify["d"]) => void;
    "ready": (d: opcode.ready["d"]) => void;
    "session_description": (d: opcode.session["d"]) => void;
    "disconnect": (code: number, reason: string) => void;
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
    private heartbeat = {
        lastInterval: null as number | null,
        interval: null as NodeJS.Timeout,
        timeout: null as NodeJS.Timeout,
        timeoutMs: 5e3,
        reconnects: 0 as number
    };

    /**
     * @description Фрагмент IP Discovery
     * @public
     */
    public ssrc: number;

    /**
     * @description Данные идентификационного пакета для повторной идентификации
     * @private
     */
    private _rejoinData: opcode.identify["d"];

    /**
     * @description Данные для порядковой очереди пакетов
     * @public
     */
    public req = {
        ask: 0, // Номер последнего принятого пакета
        seq: 0  // Номер последнего полученного пакета
    };

    /**
     * @description Отправляем пакет для работы discord
     * @param payload - Данные Discord Voice Opcodes
     * @public
     */
    public set packet(payload: opcode.extract) {
        // Перехватываем пакет для переподключения
        if (payload.op === VoiceOpcodes.Identify) this._rejoinData = payload.d;

        if (this._client.readyState === WebSocket.OPEN) {
            this._client.send(JSON.stringify(payload));
        }
    };

    /**
     * @description Разрываем соединение с Discord
     * @public
     */
    public get disconnect() {
        clearInterval(this.heartbeat.interval);
        this._client.close(1000, "Client disconnect");

        return true;
    };

    /**
     * @description Заставляем Discord принять подключение
     * @public
     */
    private get op_identify(): opcode.identify {
        return {
            op: VoiceOpcodes.Identify,
            d: this._rejoinData
        };
    };

    /**
     * @description Данные для возобновления подключения
     * @private
     */
    private get op_resume(): opcode.resume {
        return {
            op: VoiceOpcodes.Resume,
            d: {
                server_id: this._rejoinData.server_id,
                session_id: this._rejoinData.session_id,
                token: this._rejoinData.token,
                seq_ack: this.req.ask
            }
        };
    };

    /**
     * @description Данные для ответа жизни websocket
     * @private
     */
    private get op_heartbeat(): opcode.heartbeat {
        return {
            op: VoiceOpcodes.Heartbeat,
            d: {
                t: Date.now(),
                seq_ack: this.req.ask
            }
        };
    };

    /**
     * @description Создаем класс
     * @param endpoint - Путь подключения
     */
    public constructor(private readonly endpoint: string) {
        super();
    };

    /**
     * @description
     * @private
     */
    private resume() {
        if (!this._rejoinData.session_id) {
            this.emit("warn", "RESUME called without sessionId or token.");
            this.packet = this.op_identify; // Если данных для RESUME нет, выполняем IDENTIFY
            return null;
        }

        this.emit("debug", "Attempting to RESUME session...");
        this.packet = this.op_resume;
        return null;
    };

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @public
     */
    public connect = () => {
        this._client = new WebSocket(this.endpoint);
        this._client.on("open",   () => this.emit("open"));
        this._client.on("message", data => this.onMessage(data));
        this._client.on("close",  code => this.emit("close", code));
        this._client.on("error",  err  => this.emit("error", err));
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в string
     * @private
     */
    private onMessage = (data: Data): void => {
        let payload: opcode.extract;
        try {
            payload = JSON.parse(data.toString());
        } catch {
            this.emit("error", new Error('Invalid JSON'));
            return;
        }

        const { op, d } = payload;

        if (payload?.["s"] !== null) this.req.seq = payload["s"];

        switch (op) {
            case VoiceOpcodes.Hello: {
                this.req.ask++;
                this.startHeartbeat(d.heartbeat_interval);
                break;
            }

            case VoiceOpcodes.HeartbeatAck: {
                this.handleHeartbeatAck(d.t);
                break;
            }

            case VoiceOpcodes.Identify: {
                this.emit("identified", d);
                break;
            }

            case VoiceOpcodes.Ready: {
                this.ssrc = d.ssrc;

                // d содержит endpoint, ssrc и т.п.
                this.emit("ready", d);
                this.heartbeat.reconnects = 0; // Сбросить счётчик при успешном подключении
                break;
            }

            case VoiceOpcodes.SessionDescription: {
                // d содержит secret_key для шифрования RTP
                this.emit("session_description", d);
                break;
            }

            case VoiceOpcodes.Resumed: {
                this.emit("resumed");
                this.heartbeat.reconnects = 0;
                this.restartHeartbeat();
                break;
            }

            case VoiceOpcodes.ClientDisconnect: {
                this.emit("disconnect", d.code, d.reason);
                this.attemptReconnect();
                break;
            }
        }
    };

    /**
     * @description Проверяем кол-во переподключений
     * @private
     */
    private attemptReconnect() {
        if (this.heartbeat.interval) clearInterval(this.heartbeat.interval);
        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);

        if (this.heartbeat.reconnects >= 3) {
            this.emit("debug", "Max reconnect attempts reached. Performing full reconnect.");
            this.packet = this.op_identify;
            return;
        }

        this.heartbeat.reconnects++;
        const delay = Math.min(1000 * this.heartbeat.reconnects, 5000); // Exponential backoff

        setTimeout(() => {
            this.emit("debug", `Reconnecting... Attempt ${this.heartbeat.reconnects}`);
            this.resume();
        }, delay);
    }

    /**
     * @description Запускаем проверку жизни
     * @param intervalMs
     * @private
     */
    private startHeartbeat(intervalMs: number) {
        if (this.heartbeat.interval) clearInterval(this.heartbeat.interval);

        this.heartbeat.interval = setInterval(() => {
            this.packet = this.op_heartbeat;
            this.startHeartbeatTimeout();
        }, intervalMs);
    };

    /**
     * @description Перезапускаем циклическую систему для взаимодействия с websocket
     * @private
     */
    private restartHeartbeat() {
        if (this.heartbeat.interval) {
            clearInterval(this.heartbeat.interval);
        }

        this.req.seq = this.req.ask; // Сброс seq_ack после RESUME

        if (this.heartbeat.interval) {
            this.startHeartbeat(this.heartbeat.lastInterval);
        }
    }

    /**
     * @description Если получен ответ от циклической системы discord
     * @param ackData - Полученное время
     * @private
     */
    private handleHeartbeatAck(ackData: number) {
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
    private startHeartbeatTimeout() {
        if (this.heartbeat.timeout) clearTimeout(this.heartbeat.timeout);

        this.heartbeat.timeout = setTimeout(() => {
            this.emit("warn", "HEARTBEAT_ACK not received within timeout. Reconnecting...");
            this.attemptReconnect();
        }, this.heartbeat.timeoutMs);
    };
}


/**
 * @author SNIPPIK
 * @description Поддерживаемые коды
 * @namespace opcode
 */
namespace opcode {
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