import { VoiceUDPSocket, VoiceWebSocket, WebSocketOpcodes } from "#core/voice";
import { VoiceOpcodes, VoiceCloseCodes } from "discord-api-types/voice/v8";
import { E2EESession } from "#core/voice/managers/E2EE";
import { VoiceRTPSocket, iType} from "#native";
import { TypedEmitter } from "#structures";
import { VoiceAdapter } from "./adapter";

/**
 * @author SNIPPIK
 * @description Opcode dave mls приветствия
 * @const OPCODE_DAVE_MLS_WELCOME
 * @private
 */
const OPCODE_DAVE_MLS_WELCOME = new Uint8Array([VoiceOpcodes.DaveMlsCommitWelcome]);

/**
 * @author SNIPPIK
 * @description Opcode dave mls ключа пакета
 * @const OPCODE_DAVE_MLS_KEY
 * @private
 */
const OPCODE_DAVE_MLS_KEY = new Uint8Array([VoiceOpcodes.DaveMlsKeyPackage]);


/**
 * @author SNIPPIK
 * @description Коды игнорирования
 * @const IGNORED_OPCODES
 * @private
 */
const IGNORED_OPCODES: VoiceCloseCodes[] = [
    VoiceCloseCodes.CallTerminated
];

/**
 * @author SNIPPIK
 * @description Транспорт голосового соединения
 * @class Transport
 * @extends TypedEmitter
 * @public
 */
export class Transport extends TypedEmitter<TransportEvents> {
    private _state: TransportState = {
        code: 0,
        payload: null
    };

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @public
     */
    public _udp: VoiceUDPSocket;

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @public
     */
    public _rtp: iType<typeof VoiceRTPSocket>;

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @public
     */
    public _ws: VoiceWebSocket;

    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @public
     */
    public ssrc: number;

    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @public
     */
    public secret_key: number[];

    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @public
     */
    public _dave: E2EESession | null;

    /**
     * @description Готовность транспорта к передаче данных
     * @public
     */
    public get ready(): boolean {
        if (!this.secret_key || !this.ssrc) {
            return false;
        }

        // Логика DAVE (MLS): блокируем отправку, если сессия в процессе перехода
        // или еще не инициализировала ключи
        if (this._dave?.session) {
            if (!this._dave.session.ready || this._dave.isTransitioning || !this._dave.encrypt) {
                return false;
            }
        }

        // Проверяем есть ли ключевые элементы для отправки пакетов
        if (!this._ws || !this._udp || !this._rtp) {
            return false;
        }

        // Если нет подключения к udp
        if (this._udp.status !== "connected") {
            return false;
        }

        return this.state.code === TransportStateCode.Session;
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

                // Если UDP был поднят ранее
                if (this._udp) {
                    this._udp.destroy();
                    this._udp = null;
                }

                const udp = this._udp = new VoiceUDPSocket();

                // Таймер отключения, если не удасться отправить discovery frame
                const timeout = setTimeout(() => {
                    this.emit("close", VoiceCloseCodes.UnknownEncryptionMode,"[Transport/UDP]: Timeout to send Discovery handshake");
                }, 10000);

                udp.connect(d);

                // задержка как у настоящего клиента
                const delay = 60 + Math.floor(Math.random() * 80);

                // Запускаем таймер отправки Discovery
                setTimeout(() => {
                    const discoveryPacket = udp.discovery(d.ssrc);

                    // первый пакет
                    udp.packet(discoveryPacket);

                    // retry через ~100ms
                    setTimeout(() => {
                        if (this._udp && this._state.code === TransportStateCode.Ready) {
                            udp.packet(discoveryPacket);
                        }
                    }, 100);

                }, delay);

                /**
                 * @description Ожидаем ответ с данными для прямого подключения через NAT
                 * @event discovery
                 * @private
                 */
                udp.on("discovery", (data) => {
                    clearTimeout(timeout);

                    if (data instanceof Error) {
                        this.emit(
                            "close",
                            VoiceCloseCodes.UnknownEncryptionMode,
                            `[Transport] Discovery failed: ${data.message}`
                        );
                        return this.destroy();
                    }

                    udp.removeListener("discovery");

                    this._ws.packet = {
                        op: VoiceOpcodes.SelectProtocol,
                        d: {
                            protocol: "udp",
                            data: {
                                address: data.ip,
                                port: data.port,
                                mode: "aead_aes256_gcm_rtpsize"
                            }
                        }
                    };
                });

                /**
                 * @description Если соединение UDP было разорвано
                 * @event close
                 * @private
                 */
                udp.once("close", () => {
                    clearTimeout(timeout);
                    this.state = null;
                });

                /**
                 * @description Если UDP подключение было разорвано по какой-либо ошибке
                 * @event error
                 * @private
                 */
                udp.on("error", (error) => {
                    clearTimeout(timeout);
                    this.emit(
                        "close",
                        VoiceCloseCodes.UnknownProtocol,
                        `[Transport/UDP] ${error.message}`
                    );
                });

                return;
            }

            // Получение данных о сессии
            case TransportStateCode.Session: {
                const d = state.payload;

                // Сохраняем ключ, для повторного использования
                this.secret_key = d.secret_key;

                // Если уже есть активный RTP
                if (this._rtp) {
                    this._rtp.destroy();
                    this._rtp = null;
                }

                // Создаем подключение RTP
                this._rtp = new VoiceRTPSocket(
                    this.ssrc,
                    new Uint8Array(d.secret_key)
                );
                this.emit("info", `[Transport/RTP]: has created | ${this._rtp.mode}`);

                // Если есть поддержка DAVE
                if (E2EESession.max_version > 0) {
                    this.createDaveSession(d.dave_protocol_version);
                    this.emit("info", `[Transport/E2EE]: has created | ${d.dave_protocol_version} | Max --> ${E2EESession.max_version}`);
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
    };

    /**
     * @description Отправление аудио пакета в систему rust cycle
     * @public
     */
    public packet = (frame: Buffer, type: "raw" | "rtp" = "rtp") => {
        try {
            if (type === "rtp") {
                // Логика DAVE (MLS)
                if (this._dave?.session?.ready) {
                    const encrypted = this._dave.encrypt(frame);
                    if (encrypted) frame = encrypted;

                    // Если DAVE не смог зашифровать, то просто не отдает пакет
                    else {
                        this.packet(frame, type);
                        return;
                    }
                }

                frame = this._rtp.packet(frame);
            }

            // Прямая отправка в сокет
            this._udp?.packet(frame);

        } catch (err) {
            this.emit("info", `[Transport/Packet]: ${err}`);
        }
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
                    max_dave_protocol_version: E2EESession.max_version
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
        this._ws.on("close", (code, reason) => {
            // Сообщаем что хотим переподключится
            this.emit("close", code, `[Transport/WS]: ${reason}`);

            // Коды которые просто игнорируются
            if (IGNORED_OPCODES.includes(code)) return;

            // Если можно возобновить подключение
            else if ((code === 4_015 || code < 4_000) && this.ready) {
                this.state = {
                    code: TransportStateCode.OpeningWs,
                    payload: code
                };
                return;
            }

            else if (code !== 4006) {
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
     * @description Создание Dave
     * @param version - Версия dave которую использует discord
     * @private
     */
    private createDaveSession = (version: number) => {
        const { user_id, channel_id } = this.adapter.packet.state;
        let session: E2EESession;

        // Отключаем все события от ws
        this._ws.removeListener("daveSession");
        this._ws.removeListener("binary");

        // Если уже есть активная сессия
        if (this._dave) {
            this._dave.destroy();
            this._dave = null;
        }

        // Создаем сессию
        session = this._dave = new E2EESession(version, user_id, channel_id);

        /**
         * @description Создаем слушателя события для получения ключа
         * @event
         */
        session.on("key", (key) => {
            if (!this.secret_key && !this.ssrc) return;

            // Если голосовое подключение готово
            this._ws.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
        });

        /**
         * @description Сообщаем что мы тоже хотим использовать DAVE
         * @event
         */
        session.on("invalidateTransition", (transitionId) => {
            if (!this.secret_key && !this.ssrc) return;

            // Если голосовое подключение готово
            this._ws.packet = {
                op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                d: {
                    transition_id: transitionId
                }
            };
        });

        /**
         * @description Получаем коды dave от WebSocket
         * @code 21-31
         */
        this._ws.on("daveSession", ({op, d}) => {
            this.emit("info", `[DAVE/WS]: ${op} -> Opcode: ${d}`);

            switch (op) {
                // Предстоит понижение версии протокола DAVE
                case VoiceOpcodes.DavePrepareTransition: {
                    const sendReady = session.prepareTransition(d);

                    if (sendReady) this._ws.packet = {
                        op: VoiceOpcodes.DaveTransitionReady,
                        d: {
                            transition_id: d.transition_id
                        }
                    };
                    return;
                }

                // Выполнить ранее объявленный переход протокола
                case VoiceOpcodes.DaveExecuteTransition: {
                    session.executeTransition(d.transition_id);
                    return;
                }

                case VoiceOpcodes.DavePrepareEpoch: {
                    session.prepareEpoch = d;
                    return;
                }
            }
        });

        /**
         * @description Получаем буфер от webSocket
         * @code 21-31
         */
        this._ws.on("binary", ({op, payload}) => {
            this.emit("info", `[DAVE/WS]: ${op} -> Buffer Size: ${payload.length}`);

            switch (op) {
                // Учетные данные и открытый ключ для внешнего отправителя MLS
                case VoiceOpcodes.DaveMlsExternalSender: {
                    this._dave.externalSender = payload;
                    return;
                }

                // Предложения MLS, которые будут добавлены или отозваны
                case VoiceOpcodes.DaveMlsProposals: {
                    const proposal = this._dave.processProposals(payload, this.adapter.clients.array);

                    // Меняем протокол DAVE
                    if (proposal) this._ws.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, proposal]);
                    return;
                }

                // MLS Commit будет обработан для предстоящего перехода
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition: {
                    const { transition_id, success } = this._dave.processMLSTransit("commit", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) {
                            this._ws.packet = {
                                op: VoiceOpcodes.DaveTransitionReady,
                                d: { transition_id },
                            };
                        }
                    }

                    return;
                }

                // MLS Добро пожаловать в группу для предстоящего перехода
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transition_id, success } = this._dave.processMLSTransit("welcome", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) {
                            this._ws.packet = {
                                op: VoiceOpcodes.DaveTransitionReady,
                                d: { transition_id },
                            };
                        }
                    }
                }
            }
        });

        session.on("debug", (msg) => this.emit("info", `[Transport/Dave]: ${msg}`));

        // Запускаем заново или впервые
        session.reinit();
    };

    /**
     * @description Уничтожаем голосовой транспорт
     * @public
     */
    public destroy = () => {
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
    OpeningWs,
    Identifying,
    Session,
    Ready,
    Resuming,
    Closed,
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