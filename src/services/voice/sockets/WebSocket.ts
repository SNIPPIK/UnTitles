import {MessageEvent as WebSocketEvent, WebSocket as WS, CloseEvent} from "ws";
import {VoiceOpcodes} from "discord-api-types/voice/v4";
import {TypedEmitter} from "@utils";

/**
 * @author SNIPPIK
 * @description WebSocket для взаимодействия с discord, node.js не предоставляет свой
 * @class WebSocket
 * @public
 */
export class WebSocket extends TypedEmitter<WebSocketEvents> {
    /**
     * @description Класс сокета для подключения к серверам discord
     * @readonly
     * @private
     */
    private readonly webSocket: WS = null;

    /**
     * @description Данные для проверки жизни
     * @readonly
     * @private
     */
    private readonly KeepAlive = {
        interval: null, miss: 0, send: 0
    };

    /**
     * @description Устанавливает/очищает интервал для отправки сердечных сокращений по веб-сокету.
     * @param ms - Интервал в миллисекундах. Если значение отрицательное, интервал будет сброшен
     * @public
     */
    public set keepAlive(ms: number) {
        if (this.KeepAlive.interval !== undefined) clearInterval(this.KeepAlive.interval);

        // Если есть время для проверки жизни
        if (ms > 0) this.KeepAlive.interval = setInterval(() => {
            if (this.KeepAlive.send !== 0 && this.KeepAlive.miss >= 3) {
                // Пропущено слишком - отключаемся
                this.keepAlive = -1;

                try {
                    this.webSocket.close();
                } catch {
                   // Скорее всего WebSocket уже разрушен!
                }
            }

            // Задаем время и прочие параметры для правильной работы
            this.KeepAlive.send = Date.now();
            this.KeepAlive.miss++;

            // Отправляем пакет
            this.packet = {
                op: VoiceOpcodes.Heartbeat,
                d: this.KeepAlive.send
            };
        }, ms);
    };

    /**
     * @description Отправляет пакет с возможностью преобразования в JSON-строку через WebSocket.
     * @param packet - Пакет для отправки
     * @public
     */
    public set packet(packet: string | object) {
        try {
            this.webSocket.send(JSON.stringify(packet));
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Создаем WebSocket для передачи голосовых пакетов
     * @param address - Адрес сервера для соединения
     * @public
     */
    public constructor(address: string) {
        super();
        const WebSocket = new WS(address);

        WebSocket.onmessage = this.onmessage;
        WebSocket.onopen = (event) => this.emit("open", event as any);
        WebSocket.onclose = (event) => this.emit("close", event as any);
        WebSocket.onerror = (event) => this.emit("error", event as any);

        // Задаем сокет в класс
        this.webSocket = WebSocket;
    };

    /**
     * @description Используется для перехвата сообщения от сервера
     * @param event - Данные для перехвата
     * @readonly
     * @private
     */
    private readonly onmessage = (event: WebSocketEvent) => {
        if (typeof event.data !== "string") return;

        let packet: any;
        try {
            packet = JSON.parse(event.data);
        } catch (error) {
            this.emit("error", error as Error);
        }

        // Если надо обновить интервал жизни
        if (packet.op === VoiceOpcodes.HeartbeatAck) this.KeepAlive.miss = 0;

        this.emit("packet", packet);
    };

    /**
     * @description Уничтожает голосовой веб-сокет. Интервал очищается, и соединение закрывается
     * @public
     */
    public destroy = (code?: number): void => {
        try {
            this.keepAlive = -1;
            this.webSocket.close(code);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };
}

/**
 * @description События для VoiceWebSocket
 * @interface WebSocketEvents
 * @class VoiceWebSocket
 */
interface WebSocketEvents {
    "error": (error: Error) => void;
    "open": (event: Event) => void;
    "close": (event: CloseEvent) => void;
    "packet": (packet: any) => void;
}