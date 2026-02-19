import type { APIVoiceState, GatewayVoiceServerUpdateDispatchData } from "discord-api-types/v10";
import { SpeakerType, VoiceSpeakerManager } from "#core/voice/modules/Speaker";
import { type DiscordGatewayAdapterCreator, VoiceAdapter } from "./adapter";
import { GatewayCloseCodes, type WebSocketOpcodes } from "#core/voice";
import { VoiceReceiver } from "#core/voice/structures/receiver";
import { VoiceRTPSocket } from "./protocols/VoiceRTPSocket";
import { VoiceWebSocket } from "./protocols/VoiceWebSocket";
import { VoiceUDPSocket } from "./protocols/VoiceUDPSocket";
import { E2EESession } from "#core/voice/managers/E2EE";
import { VoiceOpcodes } from "discord-api-types/voice";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection extends TypedEmitter<VoiceConnectionEvents> {
    /**
     * @description Таймер переподключения
     * @private
     */
    private _reconnectTimer: NodeJS.Timeout | null = null;

    /**
     * @description Класс слушателя, если надо слушать пользователей
     * @usage нужно указать self_deaf = false
     * @public
     */
    public receiver: VoiceReceiver | null;

    /**
     * @description Функции для общения с websocket клиента
     * @public
     */
    public adapter: VoiceAdapter | null = new VoiceAdapter();

    /**
     * @description Менеджер спикера
     * @private
     */
    private speaker: VoiceSpeakerManager | null = new VoiceSpeakerManager(this);

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @public
     */
    public websocket: VoiceWebSocket | null = new VoiceWebSocket();

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @public
     */
    public udp: VoiceUDPSocket | null = new VoiceUDPSocket();

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @public
     */
    public sRTP: VoiceRTPSocket | null;

    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @public
     */
    public e2EE: E2EESession | null;

    /**
     * @description Дополнительные данные подключения
     * @private
     */
    public _attention = {
        ssrc: null as number,
        secret_key: null as number[],
    };

    /**
     * @description Текущий статус подключения
     * @private
     */
    private _status: VoiceConnectionStatus;

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Записываем текущий статус подключения
     * @public
     */
    public set status(status) {
        if (status !== this._status) {
            this.emit("log", `[Voice]: swap status ${this._status} - ${status}`);

            this._status = status;
        }
    };

    /**
     * @description Текущая задержка голосового подключения
     * @public
     */
    public get latency() {
        return this.websocket?.latency;
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get isReadyToSend(): boolean {
        // Базовая проверка статуса и наличия необходимых модулей
        if (this._status !== VoiceConnectionStatus.ready || !this.udp) {
            return false;
        }

        // Проверка состояния WebSocket (должен быть не просто "не null", а именно "connected")
        else if (this.websocket?.status !== "connected") {
            return false;
        }

        // Логика DAVE (MLS): блокируем отправку, если сессия в процессе перехода
        // или еще не инициализировала ключи
        if (this.e2EE) {
            const session = this.e2EE.session;
            if (!session) return false;

            // Если идет переход (transition) или сессия не готова — слать нельзя,
            // иначе Discord отбросит пакеты из-за неверного ключа
            if (!session.ready || this.e2EE.isTransitioning) {
                return false;
            }
        }

        // Финальная проверка UDP
        return this.udp.status === "connected";
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public get disconnect() {
        this.status = VoiceConnectionStatus.disconnected;
        this.configuration.channel_id = null; // Удаляем id канала

        // Отправляем в discord сообщение об отключении бота
        return this.adapter?.sendPayload(this.configuration);
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set channel(ID: string) {
        // Прописываем новый id канала
        this.configuration.channel_id = ID;
        this.adapter?.sendPayload(this.configuration);
    };

    /**
     * @description Данные из VOICE_STATE_UPDATE
     * @returns APIVoiceState
     * @public
     */
    public get voiceState(): APIVoiceState {
        return this.adapter.packet.state;
    };

    /**
     * @description Данные из VOICE_SERVER_UPDATE
     * @returns GatewayVoiceServerUpdateDispatchData
     * @public
     */
    public get serverState(): GatewayVoiceServerUpdateDispatchData {
        return this.adapter.packet.server;
    };

    /**
     * @description Создаем голосовое подключение
     * @param configuration - Данные для подключения
     * @param adapterCreator - Параметры для сервера
     * @constructor
     * @public
     */
    public constructor(public configuration: VoiceConnectionConfiguration, adapterCreator: DiscordGatewayAdapterCreator) {
        super();
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet) => {
                this.adapter.packet.server = packet;

                // Если есть точка подключения
                if (packet.endpoint) {
                    this.createWebSocket(packet.endpoint);
                    this.emit("log", `[Voice]: receive on onVoiceServerUpdate`);
                }
            },

            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             */
            onVoiceStateUpdate: (packet) => {
                this.adapter.packet.state = packet;
                this.emit("log", `[Voice]: receive on onVoiceStateUpdate`);
            },

            /**
             * @description Регистрируем удаление данных из класса голосового подключения
             */
            destroy: this.destroy
        });

        // Инициализируем подключение
        if (this.adapter) this.adapter.sendPayload(this.configuration);
        this._status = VoiceConnectionStatus.connected;

        // Если включен микрофон бота тогда запускаем класс слушатель
        if (!configuration.self_deaf) {
            this.receiver = new VoiceReceiver(this);
        }
    };

    /**
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param frame - Аудио пакет OPUS
     * @param type - Тип шифрования данных
     * @public
     */
    public packet = (frame: Buffer, type: "raw" | "rtp" = "rtp") => {
        if (!this.isReadyToSend) return;

        // Если надо отправить не нумерованный поток
        if (type === "raw") {
            // Отправляем не тронутый аудио фрейм
            this.udp.packet(frame);
            return;
        }

        // Если есть реализация DAVE
        if (this.e2EE && this.e2EE?.session) {
            const encrypted = this.e2EE.encrypt(frame);
            const rtp = this.sRTP.packet(encrypted);
            this.udp.packet(rtp);
        }

        // Если нет реализации DAVE
        else {
            const rtp = this.sRTP.packet(frame);
            this.udp.packet(rtp);
        }

        // Меняем состояние спикера (что бы аудио принимал Discord)
        this.speaker.speaking = this.speaker.default;
    };

    /**
     * @description Подключаемся по websocket к серверу
     * @param endpoint - точка входа
     * @param code - Код отключения
     * @private
     */
    private createWebSocket = (endpoint: string, code?: GatewayCloseCodes) => {
        this.websocket.connect(endpoint, code); // Подключаемся к endpoint
        this.websocket.removeAllListeners();

        /**
         * @description Отправляем Identify данные, для регистрации голосового подключения
         * @status Identify
         * @code 0
         */
        this.websocket.on("open", () => {
            this.websocket.packet = {
                op: VoiceOpcodes.Identify,
                d: {
                    server_id: this.configuration.guild_id,
                    session_id: this.voiceState.session_id,
                    user_id: this.voiceState.user_id,
                    token: this.serverState.token,
                    max_dave_protocol_version: E2EESession.max_version
                }
            };

            this.emit("createWS", `[WS]: Send identify data`);
        });

        /**
         * @description Если голосовое подключение готово, подключаемся по UDP
         * @status Ready
         * @code 2
         */
        this.websocket.on("ready", ({d}) => {
            this.createUDPSocket(d);

            this.emit("createUDP", `[UDP]: has created`);
        });

        /**
         * @description Если голосовое подключение готово, и получены данные для шифрования пакетов
         * @status SessionDescription
         * @code 4
         */
        this.websocket.on("sessionDescription", ({d}) => {
            this._status = VoiceConnectionStatus.SessionDescription;
            this.speaker.speaking = SpeakerType.disable;

            // Если уже есть активный RTP
            if (this.sRTP) {
                this.sRTP.destroy();
                this.sRTP = null;
            }

            // Создаем подключение RTP
            this.sRTP = new VoiceRTPSocket({
                key: new Uint8Array(d.secret_key),
                ssrc: this._attention.ssrc
            });


            // Если есть поддержка DAVE
            if (E2EESession.max_version > 0) {
                this.createDaveSession(d.dave_protocol_version);
                this.emit("createDAVE", `[E2EE]: has created | ${d.dave_protocol_version}`);
            }

            // Сохраняем ключ, для повторного использования
            this._attention.secret_key = d.secret_key;

            // Смена статуса на готов
            this._status = VoiceConnectionStatus.ready;
        });

        /**
         * @description Если websocket требует возобновления подключения
         * @status Resume
         * @code 7
         */
        this.websocket.on("resumed", () => {
            this.speaker.speaking = SpeakerType.disable;
            this.websocket.packet = {
                op: VoiceOpcodes.Resume,
                d: {
                    server_id: this.configuration.guild_id,
                    session_id: this.voiceState.session_id,
                    token: this.serverState.token,
                    seq_ack: this.websocket.sequence
                }
            };
        });

        /**
         * @description Если websocket закрывается, пытаемся его поднять или перезапустить
         * @status WS Close
         * @code 1000-4022
         */
        this.websocket.on("close", (code, reason) => {
            // Очищаем предыдущий таймер если он был
            if (this._reconnectTimer) clearTimeout(this._reconnectTimer);

            const fatalCodes = [4002, 4004, 4011, 4012, 4014, 4016];
            const isFatal = (code >= 1000 && code <= 1002) || fatalCodes.includes(code);

            if (isFatal || this._status === VoiceConnectionStatus.reconnecting) {
                return this.destroy();
            }

            // Подключения больше не существует
            else if (code === 4006 || code === 4003) {
                this.serverState.endpoint = null;
                //this.voiceState.session_id = null;
                this.adapter?.sendPayload(this.configuration);
                return; // Здесь происходит пересоздание ws подключения
            }

            // Меняем статус на переподключение
            this._status = VoiceConnectionStatus.reconnecting;

            this._reconnectTimer = setTimeout(() => {
                this.emit("log", `[${code}/${reason}]: Voice Connection reconstruct ws... 500 ms`);
                this.createWebSocket(this.serverState.endpoint, code);
            }, 500);
        });

        /**
         * @description Если websocket получил не предвиденную ошибку, то отключаемся
         * @status WS Error
         */
        this.websocket.on("error", (err) => {
            this.emit("log", err);

            this._status = VoiceConnectionStatus.disconnected;
            this.disconnect;
            this.destroy();
        });

        /**
         * @description Если подключились новые клиенты
         * @event ClientConnect
         */
        this.websocket.on("UsersRJC", ({d}) => {
            if ("user_id" in d) this.speaker.clients.delete(d.user_id);
            else {
                for (const id of d.user_ids) this.speaker.clients.add(id);
            }
        });
    };

    /**
     * @description Создание udp подключения
     * @param d - Пакет opcode.ready
     * @private
     */
    private createUDPSocket = (d: WebSocketOpcodes.ready["d"]) => {
        // Если сокет уже существует, очищаем старые слушатели перед инициализацией
        this.udp?.removeAllListeners();

        const udp = this.udp;
        this._attention.ssrc = d.ssrc; // Сохраняем SSRC сразу

        // Подключаемся
        udp.connect(d);

        // Выполняем IP Discovery
        const discoveryPacket = udp.discovery(d.ssrc);
        udp.packet(discoveryPacket);

        // Используем once для разовых событий, но с обработкой ошибок
        udp.on("discovery", (data) => {
            if (data instanceof Error) {
                this.emit("log", `[Voice] Discovery failed: ${data.message}`);
                return this.destroy();
            }

            // Проверяем, не успели ли мы отключиться за время discovery
            if (!this.websocket || this._status === VoiceConnectionStatus.disconnected) return;

            // Если ответ получен, то удаляем слушателя
            udp.removeListener("discovery");
            this.websocket.packet = {
                op: VoiceOpcodes.SelectProtocol,
                d: {
                    protocol: "udp",
                    data: {
                        address: data.ip,
                        port: data.port,
                        mode: VoiceRTPSocket.mode // Например: "aead_aes256_gcm_rtp_size"
                    }
                }
            };
        });

        // Обработка закрытия: используем именованную функцию или аккуратный once
        udp.once("close", () => {
            if (this._status === VoiceConnectionStatus.disconnected || this._status === VoiceConnectionStatus.reconnecting) return;
            this.websocket?.emit("warn", "UDP Socket closed unexpectedly. Reconnecting...");

            // Небольшая задержка перед пересозданием UDP, чтобы не спамить при падении сети
            setTimeout(() => {
                if (this._status !== VoiceConnectionStatus.disconnected) {
                    this.createUDPSocket(d);
                }
            }, 1000);
        });

        udp.on("error", (error) => {
            // Логируем, но не всегда уничтожаем.
            // Если это системная ошибка сокета, "close" сработает следом.
            this.emit("log", `[Voice UDP] ${error.message}`);

            if (error.message.includes("EADDRNOTAVAIL") || error.message.includes("Not found IPv4")) {
                this.destroy();
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
        this.websocket.removeListener("daveSession");
        this.websocket.removeListener("binary");

        // Если уже есть активная сессия
        if (this.e2EE) {
            this.e2EE.destroy();
            this.e2EE = null;
            session = this.e2EE = new E2EESession(version, user_id, channel_id);
        }

        // Если сессии нет
        else session = this.e2EE = new E2EESession(version, user_id, channel_id);

        /**
         * @description Получаем коды dave от WebSocket
         * @code 21-31
         */
        this.websocket.on("daveSession", ({op, d}) => {
            try {
                // Предстоит понижение версии протокола DAVE
                if (op === VoiceOpcodes.DavePrepareTransition) {
                    const sendReady = session.prepareTransition(d);

                    if (sendReady)
                        this.websocket.packet = {
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
                this.emit("log", `[Voice/${this.configuration.guild_id}] DAVE error: ${err}`);
                const transitionId = typeof d === "object" && d ? d["transition_id"] ?? 0 : 0;

                // Optional: попробовать сбросить сессию или пересоздать DAVE
                try {
                    session.reinit();
                    this.websocket.packet = {
                        op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                        d: {
                            transition_id: transitionId
                        }
                    };
                } catch (fallbackErr) {
                    this.emit("log", `[Voice/${this.configuration.guild_id}] DAVE fallback failed: ${fallbackErr}`);
                }
            }
        });

        /**
         * @description Получаем буфер от webSocket
         * @code 21-31
         */
        this.websocket.on("binary", ({op, payload}) => {
            switch (op) {
                // Учетные данные и открытый ключ для внешнего отправителя MLS
                case VoiceOpcodes.DaveMlsExternalSender: {
                    this.e2EE.externalSender = payload;
                    return;
                }

                // Предложения MLS, которые будут добавлены или отозваны
                case VoiceOpcodes.DaveMlsProposals: {
                    const proposal = this.e2EE.processProposals(payload, this.speaker.clients.array);

                    // Меняем протокол DAVE
                    if (proposal) this.websocket.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, proposal]);
                    return;
                }

                // MLS Commit будет обработан для предстоящего перехода
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition: {
                    const { transition_id, success } = this.e2EE.processMLSTransit("commit", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) this.websocket.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }

                    return;
                }

                // MLS Добро пожаловать в группу для предстоящего перехода
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transition_id, success } = this.e2EE.processMLSTransit("welcome", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) this.websocket.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }
                }
            }
        });


        /**
         * @description Создаем слушателя события для получения ключа
         * @event
         */
        session.on("key", (key) => {
            // Если голосовое подключение готово
            if (this._status === VoiceConnectionStatus.ready || this._status === VoiceConnectionStatus.SessionDescription) {
                this.websocket.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
            }
        });

        /**
         * @description Сообщаем что мы тоже хотим использовать DAVE
         * @event
         */
        session.on("invalidateTransition", (transitionId) => {
            // Если голосовое подключение готово
            if (this._status === VoiceConnectionStatus.ready || this._status === VoiceConnectionStatus.SessionDescription) {
                this.websocket.packet = {
                    op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                    d: {
                        transition_id: transitionId
                    }
                };
            }
        });
        session.on("debug", (msg) => this.emit("log", msg));

        // Запускаем заново или впервые
        session.reinit();
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        this.emit("log", `[Voice/${this.configuration.guild_id}] has destroyed`)

        if (this._status === VoiceConnectionStatus.disconnected) return;
        this.status = VoiceConnectionStatus.disconnected;

        // Сначала останавливаем таймеры
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        // Закрываем сетевые соединения
        this.websocket?.destroy(); // Мягкое закрытие
        this.udp?.destroy();

        // Удаляем тяжелые ссылки
        this.e2EE?.destroy();
        this.receiver?.destroy();

        // Очищаем адаптер последним
        this.adapter?.adapter?.destroy();

        // Nullify
        this.websocket = null;
        this.udp = null;
        this.sRTP = null;
        this.receiver = null;
        this.e2EE = null;
        this.adapter = null;
        this.speaker = null;
        this._status = null;
    };
}

/**
 * @author SNIPPIK
 * @description События голосового подключения
 * @interface VoiceConnectionEvents
 * @private
 */
interface VoiceConnectionEvents {
    /**
     * @description Событие подключения к голосовому каналу
     * @readonly
     */
    readonly "connect": () => void;

    /**
     * @description Событие отключения от голосового канала
     * @readonly
     */
    readonly "disconnect": () => void;

    /**
     * @description Событие получения лога от голосового канала
     * @readonly
     */
    readonly "log": (status: string | Error) => void;

    /**
     * @description Событие при котором DAVE/E2EE готов к эксплуатации
     * @readonly
     */
    readonly "createDAVE": (status: string) => void;

    /**
     * @description Событие при котором UDP готов к эксплуатации
     * @readonly
     */
    readonly "createUDP": (status: string) => void;

    /**
     * @description Событие при котором WS готов к эксплуатации
     * @readonly
     */
    readonly "createWS": (status: string) => void;
}

/**
 * @author SNIPPIK
 * @description Статусы подключения голосового соединения
 * @enum VoiceConnectionStatus
 * @private
 */
enum VoiceConnectionStatus {
    // Полностью готов
    ready = "ready",

    // Отключен
    disconnected = "disconnected",

    // Подключен
    connected = "connected",

    // Получение данных для подключения RTP
    SessionDescription = "sessionDescription",

    // Если происходит переподключение
    reconnecting = "reconnecting"
}

/**
 * @author SNIPPIK
 * @description Параметры для создания голосового соединения
 * @interface VoiceConnectionConfiguration
 * @public
 */
export interface VoiceConnectionConfiguration {
    /**
     * @description Идентификатор гильдии
     * @private
     */
    guild_id?:    string;

    /**
     * @description Идентификатор канала
     * @private
     */
    channel_id:   string;

    /**
     * @description Отключен ли звук
     * @private
     */
    self_deaf:    boolean;

    /**
     * @description Приглушен ли бот (отключен микрофон)
     * @private
     */
    self_mute:    boolean;

    /**
     * @description Будет ли бот транслировать с помощью "Go Live"
     * @deprecated
     */
    self_stream?: boolean;

    /**
     * @description Тип спикера, для отправки аудио пакетов в голосовой канал
     * @private
     */
    self_speaker?: SpeakerType;
}

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