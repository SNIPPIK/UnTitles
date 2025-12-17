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
import { Logger } from "#structures";

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection {
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
     * @description Подготавливает аудио пакет и немедленно отправляет его.
     * @param frame - Аудио пакет OPUS
     * @public
     */
    public set packet(frame: Buffer) {
        // Если статус позволяет отправлять аудио
        if (!frame || this._status !== VoiceConnectionStatus.ready) return;

        // Если есть клиенты для шифрования и отправки
        else if (!this.udp || !this.sRTP) return;

        // Меняем состояние спикера
        this.speaker.speaking = this.speaker.default;

        // Возможно ли использовать E2EE
        const encrypted = this.e2EE.encrypt(frame) ?? frame;
        this.udp.packet = this.sRTP.packet(encrypted);
    };

    /**
     * @description Отправляем нетронутый аудио фрейм
     * @param frame
     * @public
     */
    public set raw_packet(frame: Buffer) {
        if (this._status === VoiceConnectionStatus.ready && frame) {
            // Отправляем не тронутый аудио фрейм
            if (this.udp) this.udp.packet = frame;
        }
    };

    /**
     * @description Текущая задержка голосового подключения
     * @public
     */
    public get latency() {
        return this.websocket?.latency || 40;
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get isReadyToSend(): boolean {
        // Если статус не готовности
        if (this._status !== VoiceConnectionStatus.ready) return false;

        // Если нет клиентов для передачи аудио
        else if (!this.sRTP && !this.udp) return false;

        // Если что-то не так с websocket подключением
        else if (this.websocket && this.websocket.status !== "connected") return false;

        // Если есть E2EE шифрование
        else if (E2EESession.version > 0) {
            if (!this.e2EE?.session?.ready) return false;
        }

        // Если основных данных нет
        return this.udp.status === "connected";
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public get disconnect() {
        this._status = VoiceConnectionStatus.disconnected;
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
        this.adapter.adapter = adapterCreator({
            /**
             * @description Регистрирует пакет `VOICE_SERVER_UPDATE` для голосового соединения. Это приведет к повторному подключению с использованием
             * новых данных, предоставленных в пакете.
             * @param packet - Полученный пакет `VOICE_SERVER_UPDATE`
             */
            onVoiceServerUpdate: (packet) => {
                this.adapter.packet.server = packet;

                // Если есть точка подключения
                if (packet.endpoint) this.createWebSocket(packet.endpoint);
            },

            /**
             * @description Регистрирует пакет `VOICE_STATE_UPDATE` для голосового соединения. Самое главное, он сохраняет идентификатор
             * канала, к которому подключен клиент.
             * @param packet - Полученный пакет `VOICE_STATE_UPDATE`
             */
            onVoiceStateUpdate: (packet) => {
                this.adapter.packet.state = packet;
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
     * @description Подключаемся по websocket к серверу
     * @param endpoint - точка входа
     * @param code - Код отключения
     * @private
     */
    private createWebSocket = (endpoint: string, code?: GatewayCloseCodes) => {
        this.websocket.connect(endpoint, code); // Подключаемся к endpoint
        this.websocket.removeAllListeners();

        // Если включен debug режим
        this.websocket.on("debug", (status, text) => Logger.log("DEBUG", `${status} ${JSON.stringify(text)}`));
        this.websocket.on("warn", (status) => Logger.log("DEBUG", status));

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
                    max_dave_protocol_version: E2EESession.version
                }
            };
        });

        /**
         * @description Если голосовое подключение готово, подключаемся по UDP
         * @status Ready
         * @code 2
         */
        this.websocket.on("ready", ({d}) => {
            this.createUDPSocket(d);
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
            if (E2EESession.version > 0) {
                this.createDaveSession(d.dave_protocol_version);
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
                this.websocket?.emit("debug", `[${code}/${reason}]`, `Voice Connection reconstruct ws... 500 ms`);
                this.createWebSocket(this.serverState.endpoint, code);
            }, 500);
        });

        /**
         * @description Если websocket получил не предвиденную ошибку, то отключаемся
         * @status WS Error
         */
        this.websocket.on("error", (err) => {
            Logger.log("ERROR", err);

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
        this.udp.connect(d); // Подключаемся по UDP к серверу

        /**
         * @description Получаем данные для отправки аудио пакетов
         * @description RTP discovery
         */
        this.udp.discovery(d.ssrc)
            .then((data) => {
                if (data instanceof Error) return this.destroy();

                this.websocket.packet = {
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
            })

            // Если не удается получить путь до сервера UDP
            .catch(this.destroy);

        /**
         * @description Если UDP подключение разорвет соединение принудительно
         * @event close
         */
        this.udp.once("close", () => {
            // Если голосовое подключение полностью отключено
            if (this._status === VoiceConnectionStatus.disconnected) return;

            // Предупреждение о закрытии и запуске заново
            this.websocket.emit("warn", `UDP Close. Reinitializing UDP socket...`);

            // Пересоздаем подключение
            this.createUDPSocket(d);
        });

        /**
         * @description Ловим ошибки при отправке пакетов
         * @event error
         */
        this.udp.once("error", (error) => {
            // Если произведена попытка подключения к закрытому каналу
            if (`${error}`.match(/Not found IPv4 address/)) {
                if (this.disconnect) this.destroy();
                return;
            }

            this.websocket.emit("warn", `UDP Error: ${error.message}. Closed voice connection!`);
        });

        // Записываем последний SSRC
        this._attention.ssrc = d.ssrc;
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
                Logger.log("ERROR", `[Voice/${this.configuration.guild_id}] DAVE error: ${err}`);
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
                    Logger.log("ERROR", `[Voice/${this.configuration.guild_id}] DAVE fallback failed: ${fallbackErr}`);
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
                    const dd = this.e2EE.processProposals(payload, this.speaker.clients);

                    // Если есть смысл менять протокол
                    if (dd) this.websocket.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, dd]);
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
        session.on("debug", (msg) => Logger.log("DEBUG", msg));

        // Запускаем заново или впервые
        session.reinit();
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        Logger.log("DEBUG", `[Voice/${this.configuration.guild_id}] has destroyed`);

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        // Использование Optional Chaining для безопасного вызова
        this.websocket?.destroy?.();
        this.udp?.destroy?.();
        this.sRTP?.destroy?.();
        this.e2EE?.destroy?.();
        this.adapter?.adapter?.destroy();
        this.speaker?.destroy();
        this.receiver?.removeAllListeners();

        // Nullify
        this.receiver = null;
        this.sRTP = null;
        this.websocket = null;
        this.udp = null;
        this.e2EE = null;
        this.adapter = null;
        this.speaker = null;
        this._status = null;
    };
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