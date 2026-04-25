import { VoiceCloseCodes, VoiceOpcodes } from "discord-api-types/voice/v8";
import { HeartbeatManager } from "../../structures/heartbeat.js";
import { type WebSocketOpcodes } from "#core/voice/index.js";
import { type Data, type MessageEvent, WebSocket } from "ws";
import { RestAPIAgent } from "#handler/rest/index.js";
import { TypedEmitter } from "#structures";
import { env } from "#app/env";

/**
 * @author SNIPPIK
 * @description Клиент для взаимодействия с discord, по методу wss
 * @class VoiceWebSocket
 * @extends TypedEmitter
 * @public
 */
export class VoiceWebSocket extends TypedEmitter<ClientWebSocketEvents> {
    private static isProxy = env.get<boolean>("proxy.ws", false);

    /**
     * @description Адрес для подключения по websocket
     * @private
     */
    private _endpoint: string;

    /**
     * @description Менеджер жизни подключения
     * @private
     */
    private _heartbeat: HeartbeatManager;

    /**
     * @description Клиент websocket secure
     * @private
     */
    private ws: WebSocket;

    /**
     * @description Последовательность запроса
     * @public
     */
    public sequence: number = -1;

    /**
     * @description Задержка WS ответа между UDP пакетами
     * @public
     */
    public get latency() {
        if (!this._heartbeat) return 60;
        return this._heartbeat?.latency;
    };

    /**
     * @description Текущий статус ws подключения
     * @public
     */
    public get status() {
        return this.ws.readyState;
    };

    /**
     * @description Отправляем пакет для работы discord
     * @param payload - Данные Discord Voice Opcodes
     * @public
     */
    public set packet(payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes | Buffer) {
        try {
            if (payload instanceof Buffer) this.ws.send(payload);
            else this.ws.send(JSON.stringify(payload));
        } catch (err) {
            // Если ws упал
            if (`${err}`.match(/Cannot read properties of null/)) {
                // Пробуем подключится заново
                this.connect(this._endpoint, VoiceCloseCodes.UnknownOpcode);
                return;
            }

            this.emit("error", err instanceof Error ? err : new Error(String(err)));
        }
    };

    /**
     * @description Реализуем внутренние системы класса для подключения
     * @public
     */
    public constructor() {
        super();
        // Создаем менеджер жизни
        this._heartbeat = new HeartbeatManager({
            // Отправка heartbeat
            send: (time) => {
                this.packet = {
                    op: VoiceOpcodes.Heartbeat,
                    d: {
                        t: time,
                        seq_ack: this.sequence
                    }
                };
            },

            // Если не получен HEARTBEAT_ACK вовремя
            onTimeout: () => {
                this.emit("close", VoiceCloseCodes.SessionTimeout, "HEARTBEAT_ACK timeout");
            },

            // Получен HEARTBEAT_ACK
            onAck: (latency) => {
                // Отправляем событие об ответе от websocket
                this.emit("info", `HEARTBEAT_ACK received. Latency: ${latency} ms`);
            }
        });
    };

    /**
     * @description Создаем подключение, websocket по ранее указанному пути
     * @param endpoint - Путь подключения
     * @param code - Последний полученный код, нужен для понимания надо ли отправлять 7 opcode
     * @returns void
     * @public
     */
    public connect = (endpoint: string, code?: VoiceCloseCodes): void => {
        // Если ws клиент уже есть
        if (this.ws) {
            // Удаляем ws, поскольку он будет создан заново
            this.reset();
        }

        this._endpoint = endpoint;
        this.ws = new WebSocket(`wss://${endpoint}?v=8`, {
            // Можно ли использовать прокси для подключения WS
            agent: VoiceWebSocket.isProxy ? RestAPIAgent : null
        });

        // Сообщение от websocket соединения
        this.ws.onmessage = this.onReceiveMessage;

        // Запуск websocket соединения
        this.ws.onopen = () => {
            this.emit("open");
            this.emit("info", `[WebSocket] has open connection`);
        };

        // Закрытие websocket соединения
        this.ws.onclose = (reason) => {
            this.emit("info", `[WebSocket/close]: ${code} - ${reason}`);

            // Отправляем данные в TypedEmitter
            this.emit("close", reason.code, reason.reason);
        };

        // Ошибка websocket соединения
        this.ws.onerror = ({error}) => {
            this.emit("warn", error);

            // Если ws уже разорвал соединение
            if (`${error}`.match(/cloused before the connection/)) {
                this.emit("close", 4006, "WebSocket has over destroyed: Repeat!");
                return;
            }

            // Если ws разорвал соединение из-за слишком долгого ответа от рукопожатия
            else if (`${error}`.match(/handshake has timed out/)) {
                this.destroy();
                return;
            }

            // Discord сам разорвал соединение из-за проблем
            else if (`${error}`.match(/Unexpected server response: 503/)) {
                this.emit("close", VoiceCloseCodes.ServerNotFound, "Unexpected server response: 503");
                return;
            }

            this.emit("error", error);
        };
    };

    /**
     * @description Читаем буфер или json в виде строчки
     * @param data - Raw данные из websocket
     * @private
     */
    private readRawData = (data: Data) => {
        // Если пришел буфер
        if (data instanceof Buffer || data instanceof ArrayBuffer) {
            const buffer = data instanceof ArrayBuffer ? Buffer.from(data) : data;
            const op = buffer.readUInt8(2) as WebSocketOpcodes.dave_opcodes["op"];
            const payload = buffer.subarray(3);
            const sequence = buffer.readUInt16BE(0);

            // Если есть последний sequence
            if (sequence) this.sequence = sequence;

            // Отправляем полученный буфер
            this.emit("binary", { op, payload });
            return null;
        }

        // Если пришло json in string значение
        let payload: WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        try {
            payload = JSON.parse(data.toString()) as WebSocketOpcodes.extract | WebSocketOpcodes.dave_opcodes;
        } catch {
            this.emit("error", new Error("Invalid JSON"));
            return null;
        }

        return payload;
    };

    /**
     * @description Принимаем сообщение со стороны websocket
     * @param data - Получаемые данные в buffer
     * @returns void
     * @private
     */
    private onReceiveMessage = (data: MessageEvent): void => {
        const payload = this.readRawData(data.data);

        // Если нет данных
        if (!payload) return null;

        // Если есть последний seq
        if ("seq" in payload) this.sequence = payload.seq;

        // Данные из пакета
        const { op, d } = payload;

        // Внутрення обработка
        switch (op) {
            // Проверка HeartbeatAck
            case VoiceOpcodes.HeartbeatAck: {
                this._heartbeat.ack();
                break;
            }

            // Проверка переподключения
            case VoiceOpcodes.Resumed: {
                this._heartbeat.start();
                break;
            }

            // Получение heartbeat_interval
            case VoiceOpcodes.Hello: {
                this._heartbeat.start(d.heartbeat_interval);
                break;
            }

            // Проверка подключения клиента
            case VoiceOpcodes.Speaking: {
                this.emit("speaking", payload as any);
                break;
            }

            // Проверка подключения/отключения клиента
            case VoiceOpcodes.ClientDisconnect:
            case VoiceOpcodes.ClientsConnect: {
                this.emit("UsersRJC", payload);
                break;
            }

            // Получение статуса готовности
            case VoiceOpcodes.Ready: {
                this.emit("ready", payload);
                break;
            }

            // Получение статуса о данных сессии
            case VoiceOpcodes.SessionDescription: {
                this.emit("sessionDescription", payload);
                break;
            }

            // Получение и выполнение любого кода DAVE/E2EE
            case VoiceOpcodes.DaveMlsCommitWelcome:
            case VoiceOpcodes.DaveTransitionReady:
            case VoiceOpcodes.DaveMlsWelcome:
            case VoiceOpcodes.DavePrepareEpoch:
            case VoiceOpcodes.DaveMlsKeyPackage:
            case VoiceOpcodes.DaveMlsInvalidCommitWelcome:
            case VoiceOpcodes.DaveMlsProposals:
            case VoiceOpcodes.DaveMlsExternalSender:
            case VoiceOpcodes.DaveExecuteTransition:
            case VoiceOpcodes.DaveMlsAnnounceCommitTransition:
            case VoiceOpcodes.DavePrepareTransition: {
                this.emit("daveSession", payload);
                break;
            }
        }
    };

    /**
     * @description Отключение текущего websocket подключения
     * @returns void
     * @public
     */
    public reset = (): void => {
        this.removeAllListeners();

        // Если есть websocket клиент
        if (this.ws) {
            this.ws.removeAllListeners();
            this.ws.close();

            if (this.ws && this.ws.readyState !== WebSocket.CLOSED) {
                this.ws.terminate();
            }
        }

        this.ws = null;

        // Если есть менеджер жизни ws
        if (this._heartbeat) this._heartbeat.stop();
    };

    /**
     * @description Уничтожаем подключение
     * @returns void
     * @public
     */
    public destroy = (): void => {
        this.reset();
        super.destroy();
        this.sequence = null;
        this._endpoint = null;

        if (this._heartbeat) {
            this._heartbeat.destroy();
            this._heartbeat = null;
        }
    };
}

/**
 * @author SNIPPIK
 * @description События выдаваемые голосовым подключением
 * @interface ClientWebSocketEvents
 */
interface ClientWebSocketEvents {
    /**
     * @description Если произошла ошибка
     * @param err - Сама ошибка
     */
    "error": (err: Error) => void;

    /**
     * @description Обычное логирование действий
     * @param text - Лог
     */
    "info": (text: string) => void;

    /**
     * @description Если получен код выключения от discord
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "close": (code: VoiceCloseCodes, reason: string) => void;

    /**
     * @description Если получен код голоса от discord, нужен для receiver
     */
    "speaking": (d: WebSocketOpcodes.speaking_get) => void;

    /**
     * @description Если добавлен новый пользователь или удален старый
     * @constructor
     */
    "UsersRJC": (d: WebSocketOpcodes.connect | WebSocketOpcodes.disconnect) => void;

    /**
     * @description Если клиент был отключен из-за отключения бота от голосового канала
     * @param code - Код отключения
     * @param reason - Причина отключения
     */
    "disconnect": (code: number, reason: string) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "ready": (opcodes: WebSocketOpcodes.ready) => void;

    /**
     * @description Событие для opcodes, приходят не все
     * @param opcodes - Не полный список получаемых opcodes
     */
    "sessionDescription": (opcodes: WebSocketOpcodes.session) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "daveSession": (opcodes: WebSocketOpcodes.dave_opcodes) => void;

    /**
     * @description Все события для работы с dave сессией
     * @param opcodes - Полный список всех протоколов Dave
     */
    "binary": (data: {op: WebSocketOpcodes.dave_opcodes["op"], payload: Buffer}) => void;

    /**
     * @description Успешное подключение WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Identify,
     *     d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          user_id: this.voiceState.user_id,
     *          token: this.serverState.token
     * }
     * ```
     */
    "open": () => void;

    /**
     * @description Требуется для переподключения WebSocket
     * @usage
     * ```
     * op: VoiceOpcodes.Resume,
     *    d: {
     *          server_id: this.configuration.guild_id,
     *          session_id: this.voiceState.session_id,
     *          token: this.serverState.token,
     *          seq_ack: this.websocket.lastAsk
     * }
     * ```
     */
    "resumed": () => void;
}