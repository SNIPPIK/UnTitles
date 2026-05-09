import type { DiscordGatewayAdapterCreator } from "#core/voice/transport/adapter.js";
import { VoiceConnection } from "#core/voice/connection.js";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { Collection } from "#structures";

// Voice Sockets
export * from "./transport/discord/VoiceWebSocket.js";
export * from "./transport/discord/VoiceUDPSocket.js";
export * from "./connection.js";


/**
 * @author SNIPPIK
 * @description Класс для хранения голосовых подключений
 * @class Voices
 * @extends Collection
 * @public
 */
export class Voices extends Collection<VoiceConnection> {
    /**
     * @description Подключение к голосовому каналу
     * @param config - Данные для подключения
     * @param adapterCreator - Функции для получения данных из VOICE_STATE_SERVER, VOICE_STATE_UPDATE
     * @returns VoiceConnection
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
        else if (connection.status === "disconnected" || connection.adapter?.packet?.state?.channel_id !== config.channel_id) {
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
 * @public
 */
export namespace WebSocketOpcodes {
    /**
     * @description Все opcode, для типизации websocket
     * @type extract
     * @public
     */
    export type extract = identify | select_protocol | ready | heartbeat | session | speaking_out | heartbeat_ask | resume | hello | resumed | disconnect | connect;

    /**
     * @description Все opcode, для работы с dave системой
     * @type dave_opcodes
     * @public
     */
    export type dave_opcodes =
        DaveMlsWelcome | DaveMlsProposals | DaveMlsExternalSender | DaveMlsCommitWelcome | DaveMlsAnnounceCommitTransition | DaveMlsKeyPackage | DaveMlsInvalidCommitWelcome |
        DaveExecuteTransition | DaveTransitionReady | DavePrepareTransition | DavePrepareEpoch;

    /**
     * @description Данные для подключения именно к голосовому каналу
     * @interface identify
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
            "max_dave_protocol_version"?: number;
        }
    }

    /**
     * @description Данные для создания UDP подключения
     * @interface select_protocol
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
     * @interface ready
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
     * @interface heartbeat
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
     * @interface session
     * @usage only-request
     * @code 4
     */
    export interface session {
        "op": VoiceOpcodes.SessionDescription;
        "d": {
            mode: string;
            secret_key: number[];
            dave_protocol_version?: number;
        };
    }

    /**
     * @description Данные для начала возможности отправки пакетов через UDP
     * @interface speaking_out
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
     * @interface speaking_get
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
     * @interface heartbeat_ask
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
     * @interface resume
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
     * @interface hello
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
     * @interface resumed
     * @usage only-request
     * @code 9
     */
    export interface resumed {
        "op": VoiceOpcodes.Resumed;
        "d": {};
    }

    /**
     * @description Данные о подключенных клиентах
     * @interface connect
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
     * @interface disconnect
     * @usage send/request
     * @code 13
     */
    export interface disconnect {
        "op": VoiceOpcodes.ClientDisconnect;
        "seq": number;
        "d": {
            user_id: string;
        }
    }

    /**
     * @description Предстоит понижение версии протокола DAVE
     * @interface DavePrepareTransition
     * @usage send
     * @code 21
     */
    export interface DavePrepareTransition {
        "op": VoiceOpcodes.DavePrepareTransition;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description Выполнить ранее объявленный переход протокола
     * @interface DaveExecuteTransition
     * @usage send
     * @code 22
     */
    export interface DaveExecuteTransition {
        "op": VoiceOpcodes.DaveExecuteTransition;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description Подтвердить готовность ранее объявленного перехода
     * @interface DaveTransitionReady
     * @usage send
     * @code 23
     */
    export interface DaveTransitionReady {
        "op": VoiceOpcodes.DaveTransitionReady;
        "d": {
            transition_id: number;
        };
    }

    /**
     * @description Скоро выйдет версия протокола DAVE или изменится группа.
     * @interface DavePrepareEpoch
     * @usage send
     * @code 24
     */
    export interface DavePrepareEpoch {
        "op": VoiceOpcodes.DavePrepareEpoch;
        "d": {
            protocol_version: number;
            epoch: number;
        };
    }

    /**
     * @description Учетные данные и открытый ключ для внешнего отправителя MLS
     * @interface DaveMlsExternalSender
     * @usage send
     * @code 25
     */
    export interface DaveMlsExternalSender {
        "op": VoiceOpcodes.DaveMlsExternalSender;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description Пакет ключей MLS для ожидающего члена группы
     * @interface DaveMlsKeyPackage
     * @usage send
     * @code 26
     */
    export interface DaveMlsKeyPackage {
        "op": VoiceOpcodes.DaveMlsKeyPackage;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description Предложения MLS, которые будут добавлены или отозваны
     * @interface DaveMlsProposals
     * @usage send
     * @code 27
     */
    export interface DaveMlsProposals {
        "op": VoiceOpcodes.DaveMlsProposals;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description MLS Commit с дополнительными приветственными сообщениями MLS
     * @interface DaveMlsCommitWelcome
     * @usage send
     * @code 28
     */
    export interface DaveMlsCommitWelcome {
        "op": VoiceOpcodes.DaveMlsCommitWelcome;
        "d": {
            transition_id: number
        };
    }

    /**
     * @description MLS Commit будет обработан для предстоящего перехода
     * @interface DaveMlsAnnounceCommitTransition
     * @usage send
     * @code 29
     */
    export interface DaveMlsAnnounceCommitTransition {
        "op": VoiceOpcodes.DaveMlsAnnounceCommitTransition;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description MLS Добро пожаловать в группу для предстоящего перехода
     * @interface DaveMlsWelcome
     * @usage send
     * @code 30
     */
    export interface DaveMlsWelcome {
        "op": VoiceOpcodes.DaveMlsWelcome;
        "d": {
            protocol_version: number
            transition_id: number
        };
    }

    /**
     * @description Отметить как недействительный коммит или приветствовать, запросить повторное добавление
     * @interface DaveMlsInvalidCommitWelcome
     * @usage send
     * @code 31
     */
    export interface DaveMlsInvalidCommitWelcome {
        "op": VoiceOpcodes.DaveMlsInvalidCommitWelcome;
        "d": {
            transition_id: number
        };
    }
}