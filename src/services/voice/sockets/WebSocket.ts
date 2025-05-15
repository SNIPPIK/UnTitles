import {Event, MessageEvent, WebSocket as WS, ErrorEvent, CloseEvent} from "ws";
import {VoiceOpcodes} from "discord-api-types/voice";
import type {WebSocketEvents} from "@service/voice";
import {TypedEmitter} from "@utils";

/**
 * @author SNIPPIK
 * @description Не поддерживаемые статус коды, они не обрабатываются в этом коде никак
 * @private
 */
const not_support_status_code: (VoiceOpcodes | number)[] = [
    VoiceOpcodes.ClientConnect,
    VoiceOpcodes.ClientDisconnect,

    // Not documented opcodes
    15, 18, 20,

    // DAVE Opcodes
    21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31
];

/**
 * @author SNIPPIK
 * @description WebSocket для взаимодействия с discord websocket
 * @class WebSocket
 * @public
 */
export class WebSocket extends TypedEmitter<WebSocketEvents> {
    /**
     * @description Класс сокета для подключения к серверам discord
     * @readonly
     * @private
     */
    private readonly socket: WS;

    /**
     * @description Данные для проверки жизни
     * @readonly
     * @private
     */
    private readonly _alive: WebSocketKeepAlive = {
        interval: null,
        updated: 0,
        miss: 0,
        asked: 0
    };

    /**
     * @description Номер отправленного пакета через websocket
     * @public
     */
    public get seq_ack() {
        return this._alive.asked;
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public set packet(packet: string | object) {
        this.socket.send(JSON.stringify(packet));
    };

    /**
     * @description Устанавливает/очищает интервал для отправки времени жизни по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное или 0, интервал будет сброшен
     * @public
     */
    public set keepAlive(ms: number) {
        if (this._alive.interval) clearInterval(this._alive.interval);

        // Если есть время для проверки жизни
        if (ms > 0) {
            // Создаем новый интервал
            this._alive.interval = setInterval(() => {
                // Если WebSocket отключен
                if (this._alive.miss >= 3 && this._alive.updated !== 0) {
                    this.destroy();
                    return;
                }

                this._alive.updated = Date.now();
                this._alive.miss++;
                this._alive.asked++;

                // Отправляем пакет
                this.packet = {
                    op: VoiceOpcodes.Heartbeat,
                    d: {
                        t: this._alive.updated,
                        seq_ack: this._alive.asked
                    }
                };
            }, ms);
        }
    };

    /**
     * @description Создаем WebSocket для передачи голосовых пакетов
     * @param endpoint - Адрес сервера для соединения
     * @public
     */
    public constructor(endpoint: string) {
        super();
        this.socket = new WS(endpoint);
        this.socket.onopen = this.onOpen;
        this.socket.onclose = this.onClose;
        this.socket.onerror = this.onError;
        this.socket.onmessage = this.onMessage;
    };

    /**
     * @description Если WebSocket открыт
     * @param e
     */
    private onOpen = (e: Event) =>
        this.emit("open", e as any);

    /**
     * @description Если WebSocket закрыт
     * @param e
     */
    private onClose = (e: CloseEvent) =>
        this.emit("close", e);

    /**
     * @description Если WebSocket выдал ошибку
     * @param e
     */
    private onError = (e: ErrorEvent) =>
        this.emit("error", e instanceof Error ? e : e.error);

    /**
     * @description Если WebSocket принял сообщение
     * @param e
     */
    private onMessage = (e: MessageEvent): void => {
        if (typeof e.data !== "string") return;

        let packet: any;
        try {
            packet = JSON.parse(e.data);
        } catch (error) {
            this.emit("error", error as Error);
            return;
        }

        // Если код не поддерживается внутри кода
        if (not_support_status_code.includes(packet.op)) return;

        // Если WebSocket сообщил новые данные
        else if (packet.op === VoiceOpcodes.HeartbeatAck) {
            this._alive.updated = Date.now();
            this._alive.miss = 0;
        }

        this.emit("packet", packet);
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code: number = 1_000) => {
        try {
            this.keepAlive = -1;
            this.socket.terminate();
            this.socket.close(code);
            this.socket.removeAllListeners();
        } catch (error) {
            this.emit("error", error as Error);
        }
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для общения с подключением к WebSocket
 * @interface WebSocketKeepAlive
 * @private
 */
interface WebSocketKeepAlive {
    /**
     * @description Интервал для общения с подключением
     * @private
     */
    interval: NodeJS.Timeout;

    /**
     * @description Номер запроса от подключения
     * @private
     */
    asked: number;

    /**
     * @description Время обновления, время последней отправки пакета о жизни подключения
     * @private
     */
    updated: number;

    /**
     * @description Упущенные запросы от WebSocket
     * @private
     */
    miss: number;
}