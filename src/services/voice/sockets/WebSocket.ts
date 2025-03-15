import {MessageEvent as WebSocketEvent, WebSocket as WS, CloseEvent} from "ws";
import {VoiceOpcodes} from "discord-api-types/voice";
import type {WebSocketEvents} from "@service/voice";
import {TypedEmitter} from "@utils";

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
     * @description Подключен ли WebSocket
     * @readonly
     * @private
     */
    private _isConnected: boolean;

    /**
     * @description Данные для проверки жизни
     * @readonly
     * @private
     */
    private readonly _alive: WebSocketKeepAlive = {
        interval: null,
        updated: 0,
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
        // Если нет подключения
        if (!this._isConnected) return;

        try {
            this.socket.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
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
                if (!this._isConnected) {
                    this.destroy();
                    return;
                }

                this._alive.updated = Date.now();

                // Отправляем пакет
                this.packet = {
                    op: VoiceOpcodes.Heartbeat,
                    d: {
                        t: this._alive.updated,
                        seq_ack: this._alive.asked
                    }
                };
                this._alive.asked++;
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
        this.socket = new WS(endpoint, { minVersion: "TLSv1.2", maxVersion: "TLSv1.3" });

        // Если WebSocket принял сообщение
        this.socket.onmessage = (event: WebSocketEvent) => {
            if (typeof event.data !== "string") return;

            try {
                this.emit("packet", JSON.parse(event.data));
            } catch (error) {
                this.emit("error", error as Error);
            }
        };

        // Если WebSocket открыт
        this.socket.once("open", (event: Event) => {
            this._isConnected = true;
            this.emit("open", event);
        });

        // Если WebSocket закрыт
        this.socket.once("close", (event: CloseEvent) => {
            this._isConnected = false;
            this.emit("close", event);
        });

        // Если WebSocket выдал ошибку
        this.socket.on("error", (event: Error) => {
            this._isConnected = false;
            this.emit("error", event);
        });
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code?: number) => {
        try {
            this.keepAlive = -1;
            this.socket.close(code);
            this.socket.terminate();
        } catch (error) {
            this.emit("error", error as Error);
        }

        this.removeAllListeners();
    };
}

/**
 * @author SNIPPIK
 * @description Параметры для общения с подключением к WebSocket
 * @interface WebSocketKeepAlive
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
}