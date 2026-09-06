import { VoiceCloseCodes, VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceWebSocket, WebSocketOpcodes } from "#core/voice/index.js";
import { MLSSession } from "#core/voice/structures/MLSSession.js";
import { VoiceAdapter } from "./adapter.js";
import { TypedEmitter } from "#structures";

// Layers
import { UDPLayer } from "#core/voice/transport/layers/UDPLayer.js";
import { RTPLayer } from "#core/voice/transport/layers/RTPLayer.js";
import { DAVELayer, OPCODE_DAVE_MLS_WELCOME } from "#core/voice/transport/layers/DAVELayer.js";


/**
 * @author SNIPPIK
 * @description Коды закрытия, из-за этох кодов не выйдет переподключится
 * @const STOP_CODES
 * @private
 */
const STOP_CODES: VoiceCloseCodes[] = [ VoiceCloseCodes.Disconnected, 1000 as any ];

/**
 * Транспорт голосового соединения Discord.
 *
 * Координирует работу трёх слоёв: WebSocket (сигнализация), UDP (передача медиа),
 * RTP (шифрование) и опционально DAVE (сквозное шифрование).
 * Управляет конечным автоматом состояний подключения и автоматическим
 * восстановлением после обрывов.
 *
 * @extends TypedEmitter<TransportEvents>
 */
export class Transport extends TypedEmitter<TransportEvents> {
    /**
     * Текущее состояние транспорта.
     * Содержит код состояния и связанные с ним данные (payload).
     */
    private _state: TransportState = {
        code: TransportStateCode.Closed,
        payload: null
    };

    /**
     * Слой UDP-соединения для отправки голосовых пакетов.
     * Может быть `null` после уничтожения транспорта.
     */
    public _udp: UDPLayer | null = new UDPLayer();

    /**
     * Клиент WebSocket для общения с Discord Voice Gateway.
     * Может быть `null` после уничтожения транспорта.
     */
    public _ws: VoiceWebSocket | null = new VoiceWebSocket();

    /**
     * Слой RTP для шифрования исходящих пакетов.
     * Создаётся заново при каждой успешной сессии.
     */
    private _rtp: RTPLayer | null = new RTPLayer();

    /**
     * SSRC (синхронизационный источник), полученный от Discord.
     * Используется при создании RTP-шифратора.
     */
    public ssrc: number | null = null;

    /**
     * Слой DAVE (MLS) для сквозного шифрования.
     * Инициализируется только при поддержке со стороны сервера.
     */
    private _dave: DAVELayer | null = null;

    /**
     * Количество последовательных переподключений.
     * Сбрасывается при успешном подключении.
     */
    private reconnecting: number = 0;

    /**
     * Флаг уничтожения транспорта. Блокирует повторные операции.
     */
    private destroyed = false;

    /**
     * Поколение попыток подключения UDP.
     * Гарантирует, что устаревший ответ discovery не будет применён.
     */
    private generation = 0;

    /**
     * Готовность транспорта к безопасной передаче аудио.
     *
     * Условия:
     * - транспорт не уничтожен;
     * - состояние `Session`;
     * - нет активных переподключений;
     * - WebSocket, UDP и RTP готовы;
     * - DAVE либо отсутствует, либо готов.
     */
    public get ready(): boolean {
        // Полная проверка готовности
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
     * Текущее состояние транспортного канала.
     */
    public get state() {
        return this._state;
    };

    /**
     * Устанавливает новое состояние и выполняет действия,
     * соответствующие коду состояния (открытие WS, подготовка UDP и т.д.).
     *
     * @param state - Новое состояние с кодом и полезной нагрузкой.
     */
    public set state(state: TransportState) {
        //this.emit("info", `[Transport]: ${this._state?.code} --> ${state?.code}`);

        this._state = state;
        switch (state.code) {
            // Поднимаем WebSocket
            case TransportStateCode.OpeningWs: {
                try {
                    // Подключаемся к голосовому шлюзу
                    this._ws.connect(this.adapter.packet.server.endpoint);
                } catch (err) {
                    this.emit("destroyed", VoiceCloseCodes.VoiceServerCrashed);
                }
                return;
            }

            // Поднимаем UDP после получения данных от шлюза
            case TransportStateCode.Ready: {
                this._prepareUDPConnection(state.payload).catch(() => {
                    // Coming soon
                });
                return;
            }

            // Инициализируем шифрование после получения session description
            case TransportStateCode.Session: {
                const d = state.payload;

                // Создаём AES-шифратор RTP
                this._rtp.create(this.ssrc, d.secret_key);
                this.emit("info", `[Transport/RTP]: has created`);

                // Если доступен DAVE и версия протокола не нулевая — инициализируем MLS
                if (this._dave && d.dave_protocol_version !== 0) {
                    this._dave.create(d.dave_protocol_version, this._ws);
                    this.emit("info", `[Transport/E2EE]: has created | ${d.dave_protocol_version}/${MLSSession.max_version}`);
                }

                return;
            }

            // Отправляем Identify для регистрации голосового подключения
            case TransportStateCode.Identifying: {
                this._ws.packet = {
                    op: VoiceOpcodes.Identify,
                    d: state.payload
                };
                return;
            }

            // Отправляем Resume для восстановления предыдущей сессии
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
     * Создаёт транспорт и подписывается на события WebSocket.
     *
     * @param adapter - Адаптер, содержащий данные сервера и текущего состояния клиента.
     */
    public constructor(private adapter: VoiceAdapter) {
        super();
        this._dave = new DAVELayer(this.adapter);

        /**
         * При открытии WS отправляем Identify.
         */
        this._ws.on("open", () => {
            if (this.destroyed) return;

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
         * При закрытии WS пытаемся переподключиться или завершаем работу.
         */
        this._ws.on("close", (code, reason = "Unknown") => {
            // Коды, при которых переподключение запрещено
            // Три неудачные попытки — завершаем
            if (STOP_CODES.includes(code)) {
                return;
            }

            if (this.destroyed) return;
            this.reconnecting++;

            if (this.reconnecting >= 3) {
                this.destroy();
                return;
            }

            this.emit("reconnect", code);
            this.state = {
                code: TransportStateCode.OpeningWs,
                payload: code
            };

            this.emit("close", code, `[Transport/WS]: ${reason}`);
        });

        /**
         * При сигнале resumed от шлюза отправляем Resume с текущим seq.
         */
        this._ws.on("resumed", () => {
            if (this.destroyed) return;

            const { server, state } = this.adapter.packet;

            this.state = {
                code: TransportStateCode.Resuming,
                payload: {
                    server_id: state.guild_id,
                    session_id: state.session_id,
                    token: server.token,
                    seq_ack: this._ws.sequence
                }
            };
        });

        /**
         * При готовности голосового канала запускаем подготовку UDP.
         */
        this._ws.on("ready", ({ d }) => {
            if (this.destroyed) return;

            this.reconnecting = 0; // сброс счётчика попыток
            this.ssrc = d.ssrc; // ← добавить

            this.state = {
                code: TransportStateCode.Ready,
                payload: d
            };

            this.emit("info", `[Transport/UDP]: Start creating`);
        });

        /**
         * При получении session description инициализируем шифрование.
         */
        this._ws.on("sessionDescription", ({ d }) => {
            if (this.destroyed) return;

            this.state = {
                code: TransportStateCode.Session,
                payload: d
            };
        });

        /**
         * При ошибке WS эмитим событие close без попытки переподключения.
         */
        this._ws.on("error", (err) => {
            if (this.destroyed) return;

            this.emit("close", VoiceCloseCodes.BadRequest, `[Voice/WS-Error]: \n${err.stack}`);
        });

        /**
         * Обновление списка подключённых клиентов в адаптере.
         */
        this._ws.on("Users", ({ d }) => {
            if (this.destroyed) return;

            if ("user_id" in d) {
                // Пользователь отключился — удаляем из множества
                this.adapter.clients.delete(d.user_id);
            } else {
                // Добавляем новых пользователей
                for (const id of d.user_ids) this.adapter.clients.add(id);
            }
        });


        /**
         * Обработчик сообщений WebSocket с операциями DAVE (тип `"daveSession"`).
         * Обрабатывает:
         * - `DavePrepareTransition` – подготовка перехода (возвращает DaveTransitionReady)
         * - `DaveExecuteTransition` – выполнение перехода
         * - `DavePrepareEpoch` – подготовка новой эпохи
         */
        this._ws.on("daveSession", async ({ op, d }) => {
            const client = this._dave.client;
            if (client.destroyed) return;

            switch (op) {
                /**
                 * @description Подготовка перехода (transition) на новую версию протокола DAVE.
                 *              Сервер уведомляет о предстоящем переходе (смена ключей, версии шифрования).
                 *              Вызывается `session.prepareTransition(d)`, которая возвращает `true`,
                 *              если переход требует подтверждения от клиента.
                 *              Если требуется – отправляем серверу `DaveTransitionReady` с `transition_id`,
                 *              сигнализируя о готовности к переключению.
                 */
                case VoiceOpcodes.DavePrepareTransition: {
                    const sendReady = client.prepareTransition(d);
                    if (sendReady) {
                        this._ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id: d.transition_id },
                        };
                    } else client.reinit();
                    return;
                }

                /**
                 * @description Выполнение ранее подготовленного перехода.
                 *              Сервер сообщает, что нужно активировать новое состояние (ключи, версию).
                 *              Вызывается `session.executeTransition(d.transition_id)`,
                 *              которая обновляет внутреннее состояние сессии.
                 *              Ответа не требуется.
                 */
                case VoiceOpcodes.DaveExecuteTransition: {
                    client.executeTransition(d.transition_id);
                    return;
                }

                /**
                 * @description Подготовка новой эпохи (epoch) в рамках MLS-группы.
                 *              Эпоха — это версия ключей группы (инкрементируется при каждом изменении состава).
                 *              Данные эпохи содержат новую версию протокола и другую метаинформацию.
                 *              Сохраняем их через сеттер `session.prepareEpoch = d`.
                 *              Подтверждение не требуется.
                 */
                case VoiceOpcodes.DavePrepareEpoch: {
                    client.prepareEpoch = d;
                    return;
                }
            }
        });

        /**
         * Обработчик бинарных сообщений WebSocket (тип `"binary"`).
         * Обрабатывает:
         * - `DaveMlsExternalSender` – установка внешнего отправителя.
         * - `DaveMlsProposals` – обработка предложений MLS (отправляет welcome/commit).
         * - `DaveMlsAnnounceCommitTransition` – обработка коммита для перехода.
         * - `DaveMlsWelcome` – обработка welcome-сообщения.
         */
        this._ws.on("binary", async ({ op, payload }) => {
            const client = this._dave.client;
            if (client.destroyed) return;

            switch (op) {
                /**
                 * @description Установка внешнего отправителя (External Sender) для MLS-сессии.
                 *              Внешний отправитель - это данные (сертификат и публичный ключ),
                 *              которые позволяют сессии принимать коммиты от сервера Discord.
                 *              Приходит от сервера один раз после инициализации.
                 */
                case VoiceOpcodes.DaveMlsExternalSender: {
                    client.externalSender = payload;
                    return;
                }

                /**
                 * @description Обработка предложений (Proposals) MLS:
                 *              добавление/удаление участников, обновление ключей и т.д.
                 *              Сервер присылает зашифрованные proposals.
                 *              Сессия их обрабатывает и возвращает commit + опционально welcome.
                 *              Если есть результат, отправляем его обратно серверу с префиксом-опкодом.
                 */
                case VoiceOpcodes.DaveMlsProposals: {
                    const proposal = client.processProposals(payload, this.adapter.clients.array);
                    if (proposal) {
                        this._ws.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, proposal]);
                    }
                    return;
                }

                /**
                 * @description Обработка коммита (Commit) MLS, который сервер объявляет как часть перехода.
                 *              Коммит фиксирует изменения группы (новые ключи, состав).
                 *              После успешного применения коммита необходимо отправить серверу
                 *              подтверждение `DaveTransitionReady` с идентификатором перехода.
                 */
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition: {
                    const { transition_id, success } = client.processCommit(payload);
                    if (success && transition_id !== 0) {
                        this._ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }
                    return;
                }

                /**
                 * @description Обработка welcome-сообщения (новый участник входит в группу).
                 *              Welcome приходит от сервера, когда текущая сессия добавляется в группу.
                 *              После успешной обработки нужно подтвердить готовность к переходу.
                 */
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transition_id, success } = client.processWelcome(payload);
                    if (success && transition_id !== 0) {
                        this._ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }
                    return;
                }
            }
        });
    };

    /**
     * Выполняет UDP-подключение: отправляет discovery, получает IP/порт,
     * затем отправляет Select Protocol на WebSocket.
     *
     * @param data - Данные, полученные в состоянии Ready (адрес, порт, ssrc и т.д.).
     */
    private _prepareUDPConnection = async (data: TransportState_Ready["payload"]) => {
        const generation = ++this.generation;

        this.emit("info", "[Transport/UDP]: Waiting discovery response");

        const discovery = await this._udp!.create(data);

        // Транспорт мог быть уничтожен во время ожидания discovery
        if (this.destroyed) return;

        // Если за время ожидания начата новая попытка — игнорируем старый ответ
        if (generation !== this.generation)
            return;

        // Ошибка при получении адреса — завершаем
        if (discovery instanceof Error) {
            this.emit("close", VoiceCloseCodes.ServerNotFound, discovery);
            this.destroy();
            return;
        }

        this.emit("open");

        // Сообщаем шлюзу выбранный протокол и данные для UDP
        this._ws!.packet = {
            op: VoiceOpcodes.SelectProtocol,
            d: {
                protocol: "udp",
                data: {
                    ...discovery,
                    mode: "aead_aes256_gcm_rtpsize"
                }
            }
        };
    };

    /**
     * Отправляет аудио-пакеты через всю цепочку: DAVE → RTP → UDP.
     *
     * @param frames - Массив Opus-пакетов для шифрования и отправки.
     */
    public packet = (frames: Buffer[]) => {
        this._udp.packet(
            this._rtp.packet(
                this._dave.packet(frames)
            )
        );
    };

    /**
     * Уничтожает транспорт: закрывает все слои, очищает состояние.
     *
     * Идемпотентный метод — повторный вызов не приводит к действиям.
     */
    public destroy = () => {
        if (this.destroyed) return;

        this.destroyed = true;

        this.emit("destroyed", VoiceCloseCodes.CallTerminated);

        this._state = {
            code: TransportStateCode.Closed,
            payload: null
        };

        this._ws?.destroy();
        this._udp?.destroy();
        this._rtp?.destroy();
        this._dave?.destroy();
        super.destroy();

        this._ws = null;
        this._udp = null;
        this._rtp = null;
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
export enum TransportStateCode {
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
    /** Событие переподключения WS и все компонентов */
    reconnect: (code: VoiceCloseCodes) => void;

    /** Событие об открытии подключения к Discord **/
    open: () => void;

    /** Событие с информацией от транспортного узла */
    info: (log: string) => void;

    /** Событие закрытия транспортного узла */
    close: (code: VoiceCloseCodes, error: Error | string) => void;

    /** Событие уничтожения транспортного узла */
    destroyed: (code: VoiceCloseCodes) => void;
}