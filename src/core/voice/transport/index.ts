import { VoiceCloseCodes, VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceWebSocket, WebSocketOpcodes } from "#core/voice/index.js";
import { MLSSession } from "#core/voice/structures/MLSSession.js";
import { VoiceAdapter } from "./adapter.js";
import { TypedEmitter } from "#structures";

// Layers
import { UDPLayer } from "#core/voice/transport/layers/UDPLayer.js";
import { RTPLayer } from "#core/voice/transport/layers/RTPLayer.js";
import { DAVELayer } from "#core/voice/transport/layers/DAVELayer.js";


/**
 * @author SNIPPIK
 * @description Коды закрытия, из-за этох кодов не выйдет переподключится
 * @const CLOSE_CODES
 * @private
 */
const CLOSE_CODES: VoiceCloseCodes[] = [ VoiceCloseCodes.SessionNoLongerValid, VoiceCloseCodes.Disconnected ];

/**
 * @author SNIPPIK
 * @description Транспорт голосового соединения
 * @class Transport
 * @extends TypedEmitter
 * @public
 */
export class Transport extends TypedEmitter<TransportEvents> {
    /** Текущее состояние транспорта */
    private _state: TransportState = {
        code: TransportStateCode.Closed,
        payload: null
    };

    /** Слой UDP соединения, ключевой класс для отправки пакетов */
    public _udp: UDPLayer | null = new UDPLayer();

    /** Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway */
    public _ws: VoiceWebSocket | null = new VoiceWebSocket();

    /** Слой RTP, ключевой класс для шифрования пакетов для отправки через UDP */
    private _rtp: RTPLayer | null = new RTPLayer();

    /** SSRC (синхронизационный источник), полученный от Discord. */
    public ssrc: number | null = null;

    /** Клиент Dave, для работы сквозного шифрования */
    private _dave: DAVELayer | null = null;

    /** Кол-во переподключений, требуется для безопасного отключения */
    private reconnecting: number = 0;

    /**
     * @description Готовность транспорта к безопасной передаче аудио-данных
     * @public
     */
    public get ready(): boolean {
        // Используем опциональную цепочку, чтобы избежать TypeError, если транспорт уничтожен
        return !!(
            this._ws?.ready &&
            this._dave?.ready &&
            this._rtp?.ready &&
            this._udp?.ready &&
            this._state.code === TransportStateCode.Session &&
            !this.reconnecting
        );
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

                this.emit("info", "[Transport/UDP]: Waiting discovery response");

                this._udp.create(d).then((discovery) => {
                    // Если при подключении произошла ошибка
                    if (discovery instanceof Error) {
                        this.emit("close", VoiceCloseCodes.ServerNotFound, discovery);
                        this.emit("info", `[Transport/UDP]: Bad discovery handshake`);
                        this.destroy();
                        return;
                    }

                    this.emit("open"); // Успешное подключение
                    this.emit("info", `[Transport/UDP]: Good discovery handshake | ${discovery.address}:${discovery.port}`);
                    this._ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                ...discovery,
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

                // Инициализируем RTP (AES)
                this._rtp.create(this.ssrc, d.secret_key);
                this.emit("info", `[Transport/RTP]: has created`);

                if (this._dave && d.dave_protocol_version !== 0) {
                    // Инициализируем DAVE (MLS)
                    this._dave.create(d.dave_protocol_version, this._ws);
                    this.emit("info", `[Transport/E2EE]: has created | ${d.dave_protocol_version}/${MLSSession.max_version}`);
                }

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
        // Сохраняем прошлую последовательность до очистки старого сокета
        const last_seq = this._ws?.sequence ?? -1;

        if (this._ws) {
            this._ws.removeAllListeners();
            this._ws.destroy();
            this._ws = null;
        }

        // Создаем новый экземпляр сокета
        this._ws = new VoiceWebSocket();

        // --- РЕГИСТРАЦИЯ СОБЫТИЙ (Строго ДО вызова методов отправки/подключения) ---

        /**
         * @description Отправляем Identify данные, для регистрации голосового подключения
         * @status Identify
         * @code 0
         */
        this._ws.once("open", () => {
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
         * @description Если websocket закрывается, пытаемся его поднять или перезапустить
         * @status WS Close
         * @code 1000-4022
         */
        this._ws.once("close", (code, reason = "Unknown") => {
            // Если шлюх был закрыт принудительно не пытаемся его поднять повторно
            if (this._state.code === TransportStateCode.Closed) return;

            // Если достигли лимита попыток
            if (this.reconnecting >= 3 || CLOSE_CODES.includes(code)) {
                this.destroy();
                return;
            }

            // Добавляем попытку
            this.reconnecting++;

            // Пробуем поднять соединение заново
            this.state = {
                code: TransportStateCode.OpeningWs,
                payload: code
            };

            // Сообщаем что хотим переподключится
            this.emit("close", code, `[Transport/WS]: ${reason}`);
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
            this.reconnecting = 0; // Делаем сброс попыток

            this.state = {
                code: TransportStateCode.Ready,
                payload: d
            }

            this.emit("info", `[Transport/UDP]: Start creating`);
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
        this._ws.on("Users", ({d}) => {
            if ("user_id" in d) this.adapter.clients.delete(d.user_id);
            else {
                for (const id of d.user_ids) this.adapter.clients.add(id);
            }
        });

        // --- ЗАПУСК ПОДКЛЮЧЕНИЯ ---

        // Передаем сохраненную последовательность новому сокету
        if (last_seq >= 0) {
            this._ws.sequence = last_seq;
            // Теперь это выполнится безопасно, так как слушатель "resumed" уже зарегистрирован выше
            this._ws.emit("resumed");
        }

        this._ws.connect(endpoint);
    };

    /**
     * @description Уничтожаем голосовой транспорт
     * @public
     */
    public destroy = () => {
        this.emit("destroyed", VoiceCloseCodes.CallTerminated);
        this._state.code = TransportStateCode.Closed;
        super.destroy();

        setImmediate(() => {
            // Безопасный вызов деструкторов внутренних слоев
            this._ws?.destroy?.();
            this._udp?.destroy?.();
            this._rtp?.destroy?.();
            this._dave?.destroy?.();

            // Nullify для предотвращения утечек памяти
            this._rtp = null;
            this._ws = null;
            this._udp = null;
            this._dave = null;
            this.reconnecting = null;
        });
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
    /** Код поднятия WSS подключения */
    OpeningWs = "open_ws_connection",

    /** Код отправки данных подключения */
    Identifying = "identifying",

    /** Код получения данных о сессии*/
    Session = "session_description",

    /** Код готовности к поднятию UDP */
    Ready = "ready",

    /** Код при котором возобновляется подключения WSS */
    Resuming = "resume",

    /** Код полного закрытия */
    Closed = "closed"
}

/**
 * @author SNIPPIK
 * @description События закрытия транспорта подключения
 * @interface TransportEvents
 */
interface TransportEvents {
    /** Событие об открытии подключения к Discord **/
    open: () => void;

    /** Событие с информацией от транспортного узла */
    info: (log: string) => void;

    /** Событие закрытия транспортного узла */
    close: (code: VoiceCloseCodes, error: Error | string) => void;

    /** Событие уничтожения транспортного узла */
    destroyed: (code: VoiceCloseCodes) => void;
}