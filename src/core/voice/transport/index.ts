import { VoiceRTPSocket, VoiceUDPSocket, VoiceWebSocket, WebSocketOpcodes } from "#core/voice";
import { VoiceOpcodes, VoiceCloseCodes } from "discord-api-types/voice/v8";
import { E2EESession } from "#core/voice/managers/E2EE";
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
 * @description Транспорт голосового соединения
 * @class Transport
 * @extends TypedEmitter
 * @public
 */
export class Transport extends TypedEmitter<TransportEvents> {
    private _state: TransportState;

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @public
     */
    public _udp: VoiceUDPSocket;

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @public
     */
    public _rtp: VoiceRTPSocket;

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @public
     */
    public _ws:  VoiceWebSocket;

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
        // Базовая проверка статуса и наличия необходимых модулей
        if (!this.secret_key || !this.ssrc) {
            return false;
        }

        // Логика DAVE (MLS): блокируем отправку, если сессия в процессе перехода
        // или еще не инициализировала ключи
        if (this._dave && this._dave?.session) {
            // Если идет переход (transition) или сессия не готова — слать нельзя,
            // иначе Discord отбросит пакеты из-за неверного ключа
            if (!this._dave?.session.ready || this._dave.isTransitioning || !this._dave.encrypt) {
                return false;
            }
        }

        // Финальная проверка UDP, WebSocket
        return this._ws && this._udp.status === "connected" && !!this._rtp;
    };

    /**
     * @description Текущее состояние транспортного канала
     * @public
     */
    public get state() {
        return this._state;
    }

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
                if (this._ws) {
                    this._ws.destroy();
                    this._ws = null;
                }

                this._ws = new VoiceWebSocket();

                // Если происходит возобновление сессии
                if (state.payload) {
                    this._ws.sequence = state.payload;
                    //this._ws.emit("resumed");
                }

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

                // Запуска5ем таймер отправки Discovery
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
                                mode: VoiceRTPSocket.mode
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
                this._rtp = new VoiceRTPSocket({
                    key: new Uint8Array(d.secret_key),
                    ssrc: this.ssrc
                });

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
        this.state = {
            code: TransportStateCode.OpeningWs,
            payload: null
        };
    };

    /**
     * @description Отправление аудио пакета в систему rust cycle
     * @public
     */
    public packet = (frame: Buffer, type: "raw" | "rtp" = "rtp") => {
        try {
            let payload: Buffer;

            if (type === "raw") payload = frame;
            else {
                // Логика DAVE (MLS)
                const encrypted = this._dave?.encrypt(frame);
                payload = this._rtp?.packet(encrypted);
            }

            // Прямая отправка в сокет
            this._udp?.packet(payload);
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
            // Если можно возобновить подключение
            if (code === 4_015 || code === 4009 || code < 4_000 && this.ready) {
                const lastSequence = this._ws.sequence;

                this.state = {
                    code: TransportStateCode.OpeningWs,
                    payload: lastSequence
                };
                return;
            }

            // Сообщаем что хотим переподключится
            this.emit("close", code, `[Transport/WS]: ${reason}`);
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
            // Если голосовое подключение готово
            this._ws.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
        });

        /**
         * @description Сообщаем что мы тоже хотим использовать DAVE
         * @event
         */
        session.on("invalidateTransition", (transitionId) => {
            // Если голосовое подключение готово
            this._ws.packet = {
                op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                d: {
                    transition_id: transitionId
                }
            };
        });

        session.on("debug", (msg) => this.emit("info", `[Transport/Dave]: ${msg}`));

        /**
         * @description Получаем коды dave от WebSocket
         * @code 21-31
         */
        this._ws.on("daveSession", ({op, d}) => {
            try {
                // Предстоит понижение версии протокола DAVE
                if (op === VoiceOpcodes.DavePrepareTransition) {
                    const sendReady = session.prepareTransition(d);

                    if (sendReady)
                        this._ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: {
                                transition_id: d.transition_id
                            }
                        };
                }

                // Выполнить ранее объявленный переход протокола
                else if (op === VoiceOpcodes.DaveExecuteTransition) session.executeTransition(d.transition_id);

                // Скоро выйдет версия протокола DAVE или изменится группа
                else if (op === VoiceOpcodes.DavePrepareEpoch) session.prepareEpoch = d;
            } catch (err) {
                this.emit("close", 4017, `[Transport/Dave] Critical error: ${err}`);
                const transitionId = typeof d === "object" && d ? d["transition_id"] ?? 0 : 0;

                // Optional: попробовать сбросить сессию или пересоздать DAVE
                try {
                    session.reinit();
                    this._ws.packet = {
                        op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                        d: {
                            transition_id: transitionId
                        }
                    };
                } catch (fallbackErr) {
                    this.emit("close", 4017, `[Transport/Dave] DAVE fallback failed: ${fallbackErr}`);
                }
            }
        });

        /**
         * @description Получаем буфер от webSocket
         * @code 21-31
         */
        this._ws.on("binary", ({op, payload}) => {
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
                                d: {transition_id},
                            };
                        }
                    }
                }
            }
        });

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
        this.adapter?.adapter?.destroy();

        // Nullify
        this._rtp = null;
        this._ws = null;
        this._udp = null;
        this._dave = null;
        this.adapter = null;
    };
}

interface TransportState_Ready {
    code: TransportStateCode.Ready;
    payload: WebSocketOpcodes.ready["d"];
}

interface TransportState_Identifying {
    code: TransportStateCode.Identifying;
    payload: WebSocketOpcodes.identify["d"];
}

interface TransportState_Resuming {
    code: TransportStateCode.Resuming;
    payload: WebSocketOpcodes.resume["d"];
}

interface TransportState_Session {
    code: TransportStateCode.Session;
    payload: WebSocketOpcodes.session["d"];
}

interface TransportState_OpeningWs {
    code: TransportStateCode.OpeningWs;
    payload: number;
}

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