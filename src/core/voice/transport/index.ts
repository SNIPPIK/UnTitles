import {VoiceCloseCodes, VoiceOpcodes} from "discord-api-types/voice/v8";
import {VoiceWebSocket, WebSocketOpcodes} from "#core/voice";
import {MLSSession} from "#core/voice/structures/MLSSession";
import {TypedEmitter} from "#structures";
import {VoiceAdapter} from "./adapter";

// Layers
import {UDPLayer} from "#core/voice/transport/layers/UDPLayer";
import {RTPLayer} from "#core/voice/transport/layers/RTPLayer";
import {DAVELayer} from "#core/voice/transport/layers/DAVELayer";

/**
 * @author SNIPPIK
 * @description Транспорт голосового соединения
 * @class Transport
 * @extends TypedEmitter
 * @public
 */
export class Transport extends TypedEmitter<TransportEvents> {
    /** Текущее состояние транспорта (код + полезная нагрузка). */
    private _state: TransportState = {
        code: TransportStateCode.Closed,
        payload: null
    };

    /** Слой UDP соединения, ключевой класс для отправки пакетов */
    public _udp = new UDPLayer();

    /** Слой RTP, ключевой класс для шифрования пакетов для отправки через UDP */
    public _rtp = new RTPLayer();

    /** Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway */
    public _ws = new VoiceWebSocket();

    /** Клиент Dave, для работы сквозного шифрования */
    public _dave: DAVELayer;

    /** SSRC (синхронизационный источник), полученный от Discord. */
    public ssrc: number;

    /** Секретный ключ для AES-GCM */
    public secret_key: number[];

    /**
     * @description Готовность транспорта к передаче данных
     * @public
     */
    public get ready(): boolean {
        return this.secret_key && this.ssrc && this._dave.ready && this._rtp.ready && this._udp.ready && this.state.code === TransportStateCode.Session;
    };

    /**
     * @description Текущее состояние транспортного канала
     * @public
     */
    public get state() {
        return this._state;
    };

    /**
     * @description Сеттер управляющий состоянием подключений
     * @param state
     * @public
     */
    public set state(state: TransportState) {
        this.emit("info", `[Transport]: ${this._state?.code} --> ${state?.code}`);

        this._state = state;
        switch (state.code) {
            // Поднимаем WS
            case TransportStateCode.OpeningWs: {
                this.connect(this.adapter.packet.server.endpoint);
                return;
            }

            // Поднимаем UDP
            case TransportStateCode.Ready: {
                const d = state.payload;
                this.ssrc = d.ssrc;

                this._udp.create(d).then((ws) => {
                    this.emit("info", "[Transport/UDP]: Getting out");

                    if (ws instanceof Error) {
                        this.emit("close", VoiceCloseCodes.ServerNotFound, ws);
                        this.emit("info", `[Transport/UDP]: Bad Discovery handshake`);
                        this.destroy();
                        return;
                    }

                    this.emit("info", `[Transport/UDP]: Good Discovery handshake | ${ws.ip}:${ws.port}`);
                    this._ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                address: ws.ip,
                                port: ws.port,
                                mode: "aead_aes256_gcm_rtpsize"
                            }
                        }
                    };
                });
                return;
            }

            // Получение данных о сессии
            case TransportStateCode.Session: {
                const d = state.payload;

                if (this.secret_key !== d.secret_key) {
                    // Инициализируем RTP (AES)
                    this._rtp.create(this.ssrc, d.secret_key);
                    this.emit("info", `[Transport/RTP]: has created`);

                    // Инициализируем DAVE (MLS)
                    this._dave.create(d.dave_protocol_version, this._ws);
                    this.emit("info", `[Transport/E2EE]: has created | ${d.dave_protocol_version} | Max --> ${MLSSession.max_version}`);
                }

                // Сохраняем ключ, для повторного использования
                this.secret_key = d.secret_key;
                return;
            }

            // Отправляем статус идентификации
            case TransportStateCode.Identifying: {
                this._ws.packet = {
                    op: VoiceOpcodes.Identify,
                    d: state.payload
                };
                return;
            }

            // Отправляем код переподключения к прошлому соединению ws
            case TransportStateCode.Resuming: {
                this._ws.packet = {
                    op: VoiceOpcodes.Resume,
                    d: state.payload
                };
                return;
            }
        }
    };

    /**
     * @description Создание класса прослойки
     * @param adapter - Адаптер состояния
     * @public
     */
    public constructor(private adapter: VoiceAdapter) {
        super();
        this._dave = new DAVELayer(this.adapter);
    };

    /**
     * @description Отправление аудио пакета в систему rust cycle
     * @public
     */
    public packet = (frames: Buffer[] | Buffer) => {
        const list = Array.isArray(frames) ? frames : [frames];
        const encrypted = this._dave.packet(list);
        const rtp = this._rtp.packet(encrypted);

        // Отправляем все готовые пакеты разом
        this._udp.packet(rtp);
    };

    /**
     * @description Подключаемся к серверам discord
     * @param endpoint - точка входа
     * @private
     */
    public connect = (endpoint: string) => {
        const last_seq = this._ws?.sequence;

        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.destroy();
            this._ws = null;
        }

        this._ws = new VoiceWebSocket();

        if (last_seq) {
            this._ws.sequence = last_seq;
            this._ws.emit("resumed");
        }

        this._ws.connect(endpoint); // Подключаемся к endpoint

        /**
         * @description Отправляем Identify данные, для регистрации голосового подключения
         * @status Identify
         * @code 0
         */
        this._ws.on("open", () => {
            const { server, state } = this.adapter.packet;
            this.state = {
                code: TransportStateCode.Identifying,
                payload: {
                    server_id: state.guild_id,
                    session_id: state.session_id,
                    user_id: state.user_id,
                    token: server.token,
                    max_dave_protocol_version: MLSSession.max_version
                }
            };
        });

        /**
         * @description Если websocket требует возобновления подключения
         * @status Resume
         * @code 7
         */
        this._ws.on("resumed", () => {
            const { server, state } = this.adapter.packet;
            this.state = {
                code: TransportStateCode.Resuming,
                payload: {
                    server_id: state.guild_id,
                    session_id: state.session_id,
                    token: server.token,
                    seq_ack: this._ws.sequence
                }
            }
        });

        /**
         * @description Если голосовое подключение готово, подключаемся по UDP
         * @status Ready
         * @code 2
         */
        this._ws.on("ready", ({d}) => {
            this.state = {
                code: TransportStateCode.Ready,
                payload: d
            }

            this.emit("info", `[Transport/UDP]: has created`);
        });

        /**
         * @description Если голосовое подключение готово, и получены данные для шифрования пакетов
         * @status SessionDescription
         * @code 4
         */
        this._ws.on("sessionDescription", ({d}) => {
            this.state = {
                code: TransportStateCode.Session,
                payload: d
            };
        });

        /**
         * @description Если websocket закрывается, пытаемся его поднять или перезапустить
         * @status WS Close
         * @code 1000-4022
         */
        this._ws.on("close", (code, reason = "Unknown") => {
            // Сообщаем что хотим переподключится
            this.emit("close", code, `[Transport/WS]: ${reason}`);

            // Если можно возобновить подключение
            if ((code === 4_015 || code < 4_000) && this.ready) {
                this.state = {
                    code: TransportStateCode.OpeningWs,
                    payload: code
                };
                return;
            }
            else if (code !== VoiceCloseCodes.SessionNoLongerValid && code !== VoiceCloseCodes.ServerNotFound) {
                // Если соединение не было закрыто собственноручно
                if (this.state.code !== TransportStateCode.Closed) {
                    // Пробуем поднять соединение заново
                    this.state = {
                        code: TransportStateCode.OpeningWs,
                        payload: code
                    };
                    return;
                }
            }

            // Если нет больше методов подъема соединения, то уничтожаем окончательно
            this.destroy();
        });

        /**
         * @description Если websocket получил не предвиденную ошибку, то отключаемся
         * @status WS Error
         */
        this._ws.on("error", (err) => {
            this.emit("close", VoiceCloseCodes.BadRequest, err);
        });

        /**
         * @description Если подключились новые клиенты
         * @event ClientConnect
         */
        this._ws.on("UsersRJC", ({d}) => {
            if ("user_id" in d) this.adapter.clients.delete(d.user_id);
            else {
                for (const id of d.user_ids) this.adapter.clients.add(id);
            }
        });
    };

    /**
     * @description Уничтожаем голосовой транспорт
     * @public
     */
    public destroy = () => {
        this._state.code = TransportStateCode.Closed;
        super.destroy();

        // Использование Optional Chaining для безопасного вызова
        this._ws?.destroy?.();
        this._udp?.destroy?.();
        this._rtp?.destroy?.();
        this._dave?.destroy?.();

        // Nullify
        this._rtp = null;
        this._ws = null;
        this._udp = null;
        this._dave = null;
    };
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Idle {
    code: 0;
    payload: null;
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Ready {
    code: TransportStateCode.Ready;
    payload: WebSocketOpcodes.ready["d"];
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Identifying {
    code: TransportStateCode.Identifying;
    payload: WebSocketOpcodes.identify["d"];
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Resuming {
    code: TransportStateCode.Resuming;
    payload: WebSocketOpcodes.resume["d"];
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Session {
    code: TransportStateCode.Session;
    payload: WebSocketOpcodes.session["d"];
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_OpeningWs {
    code: TransportStateCode.OpeningWs;
    payload: number;
}

/**
 * @author SNIPPIK
 * @description
 * @interface
 * @private
 */
interface TransportState_Closed {
    code: TransportStateCode.Closed;
    payload: null;
}

// Объединённый тип
type TransportState =
    | TransportState_Ready
    | TransportState_Identifying
    | TransportState_Resuming
    | TransportState_Session
    | TransportState_OpeningWs
    | TransportState_Closed
    | TransportState_Idle


/**
 * @author SNIPPIK
 * @description Все статусы подключения транспорта
 * @enum TransportStateCode
 */
enum TransportStateCode {
    OpeningWs = "open_ws_connection",
    Identifying = "identifying",
    Session = "session_description",
    Ready = "ready",
    Resuming = "resume",
    Closed = "closed",
}

/**
 * @author SNIPPIK
 * @description События закрытия транспорта подключения
 * @interface TransportEvents
 */
interface TransportEvents {
    info: (log: string) => void;
    close: (code: VoiceCloseCodes, error: Error | string) => void;
}