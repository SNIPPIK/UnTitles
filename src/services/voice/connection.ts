import { APIVoiceState, GatewayVoiceServerUpdateDispatchData } from "discord-api-types/v10";
import { DiscordGatewayAdapterCreator, VoiceAdapter } from "./adapter";
import { GatewayCloseCodes, WebSocketOpcodes } from "#service/voice";
import { VoiceReceiver } from "#service/voice/managers/receiver";
import { ClientSRTPSocket } from "./sockets/ClientSRTPSocket";
import { ClientWebSocket } from "./sockets/ClientWebSocket";
import { ClientUDPSocket } from "./sockets/ClientUDPSocket";
import { ClientDAVE } from "#service/voice/sessions/dave";
import { VoiceOpcodes } from "discord-api-types/voice";
import { Logger } from "#structures";

/**
 * @author SNIPPIK
 * @description Время через которое меняется speaking статус
 * @const KEEP_SWITCH_SPEAKING
 */
const KEEP_SWITCH_SPEAKING = 5e3;

/**
 * @author SNIPPIK
 * @description Подключение к голосовому серверу для воспроизведения аудио в голосовых каналах
 * @class VoiceConnection
 * @public
 */
export class VoiceConnection {
    /**
     * @description Класс слушателя, если надо слушать пользователей
     * @usage нужно указать self_deaf = false
     * @readonly
     * @public
     */
    public receiver: VoiceReceiver;

    /**
     * @description Функции для общения с websocket клиента
     * @readonly
     * @public
     */
    public adapter: VoiceAdapter = new VoiceAdapter();

    /**
     * @description Клиент WebSocket, ключевой класс для общения с Discord Voice Gateway
     * @private
     */
    protected websocket: ClientWebSocket = new ClientWebSocket();

    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @private
     */
    protected clientUDP: ClientUDPSocket = new ClientUDPSocket();

    /**
     * @description Клиент RTP, ключевой класс для шифрования пакетов для отправки через UDP
     * @private
     */
    protected clientSRTP: ClientSRTPSocket;

    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @protected
     */
    protected clientDave: ClientDAVE;

    /**
     * @description Таймер для автоматического отключения Speaking
     * @private
     */
    private speakingTimeout: NodeJS.Timeout | null = null;

    /**
     * @description Текущее состояние Speaking (включен/выключен)
     * @private
     */
    private _speaking: boolean = false;

    /**
     * @description Список клиентов в голосовом состоянии
     * @private
     */
    private _clients = new Set<string>();

    /**
     * @description Дополнительные данные подключения
     * @private
     */
    private _attention = {
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
        if (this._status === VoiceConnectionStatus.ready && frame) {
            this.speaking = true;
            this.resetSpeakingTimeout();

            // Если есть клиенты для шифрования и отправки
            if (this.clientUDP && this.clientSRTP) {
                const packet = this.clientDave?.encrypt(frame) ?? frame;
                this.clientUDP.packet = this.clientSRTP.packet(packet);
            }
        }
    };

    /**
     * @description Готовность голосового подключения
     * @public
     */
    public get ready(): boolean {
        // Если статус не готовности
        if (this._status !== VoiceConnectionStatus.ready) return false;

        // Если нет клиентов для передачи аудио
        else if (!this.clientSRTP && !this.clientUDP) return false;

        // Если что-то не так с websocket подключением
        else if (this.websocket && this.websocket.status !== "connected") return false;

        // Если основных данных нет
        return this.clientUDP.connected;
    };

    /**
     * @description Отправляет пакет голосовому шлюзу, указывающий на то, что клиент начал/прекратил отправку аудио.
     * @param speaking - Следует ли показывать клиента говорящим или нет
     * @public
     */
    public set speaking(speaking: boolean) {
        // Если нельзя по состоянию или уже бот говорит
        if (this._speaking === speaking) return;

        // Меняем состояние спикера
        this._speaking = speaking;

        // Обновляем статус голоса
        this.websocket.packet = {
            op: VoiceOpcodes.Speaking,
            d: {
                speaking: speaking ? 1 : 0,
                delay: 0,
                ssrc: this._attention.ssrc
            },
            seq: this.websocket.sequence
        };
    };

    /**
     * @description Отключаемся от голосового канала
     * @public
     */
    public get disconnect() {
        this._status = VoiceConnectionStatus.disconnected;
        this.configuration.channel_id = null; // Удаляем id канала

        // Отправляем в discord сообщение об отключении бота
        return this.adapter.sendPayload(this.configuration);
    };

    /**
     * @description Смена голосового канала
     * @param ID - уникальный код канала
     * @public
     */
    public set swapChannel(ID: string) {
        // Прописываем новый id канала
        this.configuration = {...this.configuration, channel_id: ID};
        this.adapter.sendPayload(this.configuration);
    };

    /**
     * @description Данные из VOICE_STATE_UPDATE
     * @returns APIVoiceState
     * @private
     */
    public get voiceState(): APIVoiceState {
        return this.adapter.packet.state;
    };

    /**
     * @description Данные из VOICE_SERVER_UPDATE
     * @returns GatewayVoiceServerUpdateDispatchData
     * @private
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
             * @private
             */
            onVoiceStateUpdate: (packet) => {
                this.adapter.packet.state = packet;
            },
            destroy: this.destroy
        });

        // Инициализируем подключение
        this.adapter.sendPayload(this.configuration);
        this._status = VoiceConnectionStatus.connected;

        // Если включен звук бота
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

        // Если включен debug режим
        //this.websocket.on("debug", console.log);
        //this.websocket.on("warn", console.log);

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
                    max_dave_protocol_version: ClientDAVE.version
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

            // После установки UDP и RTP, включаем speaking
            this.resetSpeakingTimeout();
        });

        /**
         * @description Если голосовое подключение готово, и получены данные для шифрования пакетов
         * @status SessionDescription
         * @code 4
         */
        this.websocket.on("sessionDescription", ({d}) => {
            this._status = VoiceConnectionStatus.SessionDescription;
            this.speaking = false;

            // Если есть поддержка DAVE
            if (ClientDAVE.version > 0) {
                this.createDaveSession(d.dave_protocol_version);
            }

            // Если уже есть активный RTP
            if (this.clientSRTP) {
                this.clientSRTP.destroy();
                this.clientSRTP = null;
            }

            // Создаем подключение RTP
            this.clientSRTP = new ClientSRTPSocket({
                key: new Uint8Array(d.secret_key),
                ssrc: this._attention.ssrc
            });

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
            this.speaking = false;
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
            if (code >= 1000 && code <= 1002 || code === 4002 || this._status === VoiceConnectionStatus.reconnecting) return this.destroy();

            // Подключения больше не существует
            else if (code === 4006 || code === 4003) {
                this.serverState.endpoint = null;
                this.voiceState.session_id = null;
                this.adapter.sendPayload(this.configuration);
                return; // Здесь происходит пересоздание ws подключения
            }

            this._status = VoiceConnectionStatus.reconnecting;

            setTimeout(() => {
                this.websocket?.emit("debug", `[${code}/${reason}] Voice Connection reconstruct ws... 500 ms`);
                this.createWebSocket(this.serverState.endpoint, code);
            }, 500);
        });

        /**
         * @description Если websocket получил не предвиденную ошибку, то отключаемся
         * @status WS Error
         */
        this.websocket.on("error", () => {
            this._status = VoiceConnectionStatus.disconnected;
            this.disconnect;
            this.destroy();
        });

        /**
         * @description Если подключились новые клиенты
         * @event ClientConnect
         */
        this.websocket.on("ClientConnect", ({d}) => {
            for (const id of d.user_ids) this._clients.add(id);
        });

        /**
         * @description Если отключается клиент
         * @event ClientDisconnect
         */
        this.websocket.on("ClientDisconnect", ({d}) => {
            this._clients.delete(d.user_id);
        });
    };

    /**
     * @description Создание udp подключения
     * @param d - Пакет opcode.ready
     * @private
     */
    private createUDPSocket = (d: WebSocketOpcodes.ready["d"]) => {
        this.clientUDP.connect(d); // Подключаемся по UDP к серверу

        /**
         * @description Передаем реальный ip, port для общения с discord
         * @status SelectProtocol
         * @code 1
         */
        this.clientUDP.once("connected", ({ip, port}) => {
            this.websocket.packet = {
                op: VoiceOpcodes.SelectProtocol,
                d: {
                    protocol: "udp",
                    data: {
                        address: ip,
                        port: port,
                        mode: ClientSRTPSocket.mode
                    }
                }
            };
        });

        // Если UDP подключение разорвет соединение принудительно
        this.clientUDP.on("close", () => {
            // Если голосовое подключение полностью отключено
            if (this._status === VoiceConnectionStatus.disconnected) return;

            // Пересоздаем подключение
            this.createUDPSocket(d);

            // Debug
            this.websocket.emit("warn", `UDP Close. Reinitializing UDP socket...`);
        });

        // Отлавливаем ошибки при отправке пакетов
        this.clientUDP.on("error", (error) => {
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
        const session = new ClientDAVE(version, user_id, channel_id);

        /**
         * @description Получаем коды dave от WebSocket
         * @code 21-31
         */
        this.websocket.on("daveSession", ({op, d}) => {
            // Предстоит понижение версии протокола DAVE
            if (op === VoiceOpcodes.DavePrepareTransition) {
                const sendReady = session.prepareTransition(d);

                if (sendReady)
                    this.websocket.packet = {
                        op: VoiceOpcodes.DaveTransitionReady,
                        d: {
                            transition_id: d.transition_id
                        },
                    };
            }

            // Выполнить ранее объявленный переход протокола
            else if (op === VoiceOpcodes.DaveExecuteTransition) {
                session.executeTransition(d.transition_id);
            }

            // Скоро выйдет версия протокола DAVE или изменится группа
            else if (op === VoiceOpcodes.DavePrepareEpoch) {
                session.prepareEpoch = d;
            }
        });

        /**
         * @description Получаем буфер от webSocket
         * @code 21-31
         */
        this.websocket.on("binary", ({op, payload}) => {
            if (this._status !== VoiceConnectionStatus.ready && !this.clientDave) return;

            // Учетные данные и открытый ключ для внешнего отправителя MLS
            if (op === VoiceOpcodes.DaveMlsExternalSender) {
                this.clientDave.externalSender = payload;
            }

            // Предложения MLS, которые будут добавлены или отозваны
            else if (op === VoiceOpcodes.DaveMlsProposals) {
                const dd = this.clientDave.processProposals(payload, this._clients);
                if (dd) this.websocket.packet = Buffer.concat([new Uint8Array([VoiceOpcodes.DaveMlsCommitWelcome]), dd]);
            }

            // MLS Commit будет обработан для предстоящего перехода
            else if (op === VoiceOpcodes.DaveMlsAnnounceCommitTransition) {
                const { transition_id, success } = this.clientDave.processCommit(payload);
                if (success) {
                    if (transition_id !== 0) this.websocket.packet = {
                        op: VoiceOpcodes.DaveTransitionReady,
                        d: { transition_id },
                    };
                }
            }

            // MLS Добро пожаловать в группу для предстоящего перехода
            else if (op === VoiceOpcodes.DaveMlsWelcome) {
                const { transition_id, success } = this.clientDave.processWelcome(payload);
                if (success) {
                    if (transition_id !== 0) this.websocket.packet = {
                        op: VoiceOpcodes.DaveTransitionReady,
                        d: { transition_id },
                    };
                }
            }
        });

        // Создание ключа
        session.on("key", (key) => {
            if (this._status === VoiceConnectionStatus.ready || this._status === VoiceConnectionStatus.SessionDescription) {
                this.websocket.packet = Buffer.concat([new Uint8Array([VoiceOpcodes.DaveMlsKeyPackage]), key]);
            }
        });

        // Сообщаем что мы тоже хотим использовать DAVE
        session.on("invalidateTransition", (transitionId) => {
            if (this._status === VoiceConnectionStatus.ready || this._status === VoiceConnectionStatus.SessionDescription) {
                this.websocket.packet = {
                    op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                    d: {
                        transition_id: transitionId
                    },
                };
            }
        });

        // Запускаем заново
        session.reinit();
        this.clientDave = session;
    };

    /**
     * @description Уничтожаем голосовое соединение
     * @public
     */
    public destroy = () => {
        Logger.log("DEBUG", `[Voice/${this.configuration.guild_id}] has destroyed`);

        // Если есть таймер спикера
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        // Уничтожаем подключения
        try {
            if (this.websocket && this.clientUDP) {
                this.websocket?.destroy();
                this.clientUDP?.destroy();
                this.clientSRTP?.destroy();
                this.clientDave?.destroy();
            }
        } catch {}

        // Если есть класс слушателя
        if (this.receiver) {
            this.receiver?.emitDestroy();
            this.receiver = null;
        }

        // Удаляем адаптер
        this.adapter.adapter?.destroy();

        // Удаляем клиентов
        this.clientSRTP = null;
        this.websocket = null;
        this.clientUDP = null;
        this.clientDave = null;
        this.adapter = null;

        // Удаляем данные спикера
        this.speakingTimeout = null;
        this._speaking = null;

        // Чистим список клиентов
        this._clients.clear();
        this._clients = null;

        // Меняем статус
        this._status = null;
    };

    /**
     * @description Сброс таймера отключения Speaking
     * @private
     */
    private resetSpeakingTimeout = () => {
        if (this.speakingTimeout) clearTimeout(this.speakingTimeout);

        // Выставляем таймер смены на false
        this.speakingTimeout = setTimeout(() => { this.speaking = false; }, KEEP_SWITCH_SPEAKING);
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
    guild_id?: string;

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
     */
    self_mute:    boolean;

    /**
     * @description Будет ли бот транслировать с помощью "Go Live"
     * @deprecated
     */
    self_stream?: boolean;
}