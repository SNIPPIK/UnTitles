import { DiscordGatewayAdapterCreator } from "#service/voice/adapter";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceConnection } from "#service/voice/connection";
import { Collection } from "#structures";

// Voice Sockets
export * from "./sockets/ClientWebSocket";
export * from "./sockets/ClientUDPSocket";
export * from "./sockets/ClientSRTPSocket";

// Audio
export * from "./audio/resource";
export * from "./audio/process";

// Decoder and encoders
export * from "./audio/opus";
export * from "./connection";


/**
 * @author SNIPPIK
 * @description Класс для хранения голосовых подключений
 * @class Voices
 * @extends Collection
 */
export class Voices extends Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Функции для получения данных из VOICE_STATE_SERVER, VOICE_STATE_UPDATE
     * @public
     */
    public join = (config: VoiceConnection["configuration"], adapterCreator: DiscordGatewayAdapterCreator) => {
        let connection = this.get(config.guild_id);

        // Если нет голосового подключения
        if (!connection) {
            // Если нет голосового подключения, то создаем
            connection = new VoiceConnection(config, adapterCreator);
            this.set(config.guild_id, connection);
        }

        // Если голосовое соединение не может принимать пакеты
        else if (!connection.ready || connection.status === "disconnected") {
            this.remove(config.guild_id);
            connection = new VoiceConnection(config, adapterCreator);
            this.set(config.guild_id, connection);
        }

        // Отдаем голосовое подключение
        return connection;
    };
}

/**
 * @author SNIPPIK
 * @description Все коды голосового состояния
 * @namespace WebSocketOpcodes
 */
export namespace WebSocketOpcodes {
    /**
     * @description Все opcode, для типизации websocket
     * @type extract
     */
    export type extract = identify | select_protocol | ready | heartbeat | session | speaking_out | heartbeat_ask | resume | hello | resumed | disconnect | connect;

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
    export interface speaking_out {
        "op": VoiceOpcodes.Speaking,
        "seq": number;
        "d": {
            "speaking": number;
            "delay": number;
            "ssrc": number;
        }
    }

    /**
     * @description Данные для синхронизации состояния голоса
     * @usage only-get
     * @code 5
     */
    export interface speaking_get {
        "op": VoiceOpcodes.Speaking,
        "seq": number;
        "d": {
            user_id: string;
            ssrc: number;
            speaking: number;
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
     * @description Данные о подключенных клиентах
     * @usage on-receiver
     * @code 11
     */
    export interface connect {
        "op": VoiceOpcodes.ClientsConnect;
        "seq": number;
        "d": {
            user_ids: string[]
        }
    }

    /**
     * @description Данные для отключения бота от голосового канала
     * @usage send/request
     * @code 13
     */
    export interface disconnect {
        "op": VoiceOpcodes.ClientDisconnect;
        "seq": number;
        "d": {
            user_ids: string[]
        }
    }
}

/**
 * @author SNIPPIK
 * @description Gateway Close Event Codes, для глубокой типизации и для правильного взаимодействия с WebSocket подключением
 * @enum GatewayCloseCodes
 * @public
 */
export enum GatewayCloseCodes {
    /**
     * @description Нормальное завершение соединения.
     * @reconnecting true
     */
    NORMAL_CLOSURE = 1000,

    /**
     * @description Соединение закрыто, т.к, сервер или клиент отключается.
     * @reconnecting true
     */
    GOING_AWAY = 1001,

    /**
     * @description Код экстренного выхода
     * @reconnecting true
     */
    EXIT_RESULT = 1002,

    /**
     * @description Аномальное закрытие, соединение было закрыто без фрейма закрытия.
     * @reconnecting true
     */
    ABNORMAL_CLOSURE = 1006,

    /**
     * @description Мы не уверены, что пошло не так. Попробуйте переподключиться?
     * @reconnecting true
     */
    UNKNOWN_ERROR = 4000,

    /**
     * @description Вы отправили недействительный код операции Gateway или недействительную полезную нагрузку для кода операции. Не делайте этого!
     * @reconnecting true
     */
    UNKNOWN_OPCODE = 4001,

    /**
     * @description Вы отправили недействительную полезную нагрузку в Discord. Не делайте этого!
     * @reconnecting true
     */
    DECODE_ERROR = 4002,

    /**
     * @description Вы отправили нам полезную нагрузку до идентификации, или этот сеанс был признан недействительным.
     * @reconnecting true
     */
    NOT_AUTHENTICATED = 4003,

    /**
     * @description Токен учетной записи, отправленный с вашей идентификационной информацией, неверен.
     * @reconnecting false
     */
    AUTHENTICATION_FAILED = 4004,

    /**
     * @description Вы отправили более одного идентификационного груза. Не делайте этого!
     * @reconnecting true
     */
    ALREADY_AUTHENTICATED = 4005,

    /**
     * @description Сессия больше не действительна
     * @reconnecting false
     */
    INVALID_SESSION = 4006,

    /**
     * @description Последовательность, отправленная при возобновлении сеанса, была недействительной. Подключитесь заново и начните новый сеанс.
     * @reconnecting true
     */
    INVALID_SEQ = 4007,

    /**
     * @description Ух ты, Нелли! Ты слишком быстро отправляешь нам данные. Сбавь скорость! При получении этого сообщения ты будешь отключен.
     * @reconnecting true
     */
    RATE_LIMITED = 4008,

    /**
     * @description Ваш сеанс истек. Подключитесь снова и начните новый.
     * @reconnecting true
     */
    SESSION_TIMEOUT = 4009,

    /**
     * @description При идентификации вы отправили нам недействительный осколок.
     * @reconnecting false
     */
    INVALID_SHARD = 4010,

    /**
     * @description В сеансе участвовало бы слишком много гильдий — для подключения вам потребуется разделить свое соединение.
     * @reconnecting false
     */
    SHARDING_REQUIRED = 4011,

    /**
     * @description Вы отправили недействительную версию для шлюза.
     * @reconnecting false
     */
    INVALID_API_VERSION = 4012,

    /**
     * @description Вы отправили недопустимое намерение для Gateway Intent
     * @reconnecting false
     */
    INVALID_INTENTS = 4013,

    /**
     * @description Вы отправили неразрешенное намерение для Gateway Intent
     * @reconnecting false
     */
    DISALLOWED_INTENTS = 4014,

    /**
     * @description Голосовой сервер вышел из строя
     * @reconnecting true
     */
    INSUFFICIENT_RESOURCES = 4015,

    /**
     * @description Неизвестный режим шифрования
     * @reconnecting true
     */
    OVERLOADED = 4016,

    /**
     * @description Плохой запрос
     * @reconnecting true
     */
    BAD_REQUEST = 4020,

    /**
     * @description Сессия устарела
     * @reconnecting false
     */
    SESSION_EXPIRED = 4022
}