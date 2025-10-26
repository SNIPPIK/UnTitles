import { createSocket, type Socket } from "node:dgram";
import { type WebSocketOpcodes } from "#core/voice";
import { TypedEmitter } from "#structures";
import { isIPv4 } from "node:net";
import {HeartbeatManager} from "#core/voice/managers/heartbeat";

/**
 * @author SNIPPIK
 * @description Максимальное значение счетчика активности
 * @private
 */
const MAX_SIZE_VALUE = 2 ** 32 - 1;

/**
 * @author SNIPPIK
 * @description Создает udp подключение к Discord Gateway
 * @class VoiceUDPSocket
 * @public
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    private _status: VoiceUDPSocketStatuses;

    /** Socket UDP подключения */
    private socket: Socket;

    /** Менеджер жизни подключения */
    private _heartbeat: HeartbeatManager;

    /** Данные для поддержания udp соединения */
    private keepAlive = {
        /**
         * @description Интервал для предотвращения разрыва в миллисекундах
         * @readonly
         * @private
         */
        intervalMs: 0,

        /**
         * @description Буфер, используемый для записи счетчика активности
         * @readonly
         * @private
         */
        buffer: Buffer.alloc(4),

        /**
         * @description Счетчика активности
         * @private
         */
        counter: 0
    };

    /** Данные подключения, полные данные пакета ready.d */
    public options: WebSocketOpcodes.ready["d"];

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     * @public
     */
    public set packet(packet: Buffer) {
        // Отправляем DAVE(RTP+OPUS) пакет
        this.socket.send(packet, 0, packet.length, this.options.port, this.options.ip, (err) => {
            if (err) this.emit("error", err);
        });

        this._heartbeat.ack();
    };

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Создаем класс и задаем параметры
     * @public
     */
    public constructor() {
        super();
        this._heartbeat = new HeartbeatManager({
            onTimeout: () => {
                if (this.keepAlive.counter >= MAX_SIZE_VALUE) this.keepAlive.counter = 0;
                this.keepAlive.buffer.writeUInt32BE(this.keepAlive.counter++, 0);
                this.packet = this.keepAlive.buffer;
            }
        });
    };

    /**
     * @description Подключаемся по UDP подключению
     * @param options - Данные для подключения
     * @public
     */
    public connect = (options: WebSocketOpcodes.ready["d"]) => {
        this.keepAlive.intervalMs = options.heartbeat_interval; // Меняем интервал

        // Не имеет смысла создавать заново если все данные совпадают
        if (this.options !== undefined) {
            if (options.ip === this.options.ip && options.port === this.options.port && options.ssrc === this.options.ssrc) return;
            this.removeAllListeners();
        }

        // Меняем данные
        this.options = options;

        // Если уже есть подключение
        if (this.socket) this.reset();

        // Проверяем через какое соединение подключатся
        const socket = this.socket = createSocket({
            type: isIPv4(options.ip) ? "udp4" : "udp6"
        });
        this._status = VoiceUDPSocketStatuses.connecting;

        // Отправляем пакет данных для получения реального ip, port
        this.discovery(options.ssrc);

        // Если подключение возвращает ошибки
        socket.on("error", (err) => {
            this.emit("error", err);
        });

        // Если получен ответ от сервера
        socket.on("message", (msg) => {
            this._status = VoiceUDPSocketStatuses.connected;
            this.emit("message", msg);
        });

        // Если подключение оборвалось
        socket.once("close", () => {
            this._status = VoiceUDPSocketStatuses.disconnected;
            this.emit("close");
        });

        // Запускаем менеджер жизни UDP
        this._heartbeat.start(options.heartbeat_interval);
    };

    /**
     * @description Просим указать путь до конечной точки
     * @returns void
     * @public
     */
    public discovery = (ssrc: number) => {
        const packet = Buffer.allocUnsafe(74);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        this.packet = packet;

        // Ждем получения сообщения после отправки код, для подключения UDP
        this.socket.once("message", (packet) => {
            if (packet.readUInt16BE(0) === 2) {
                const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");
                const port = packet.readUInt16BE(packet.length - 2);

                // Если провайдер не предоставляет или нет пути IPV4
                if (!isIPv4(ip)) {
                    this.emit("error", Error("Not found IPv4 address"));
                    return;
                }

                this._status = VoiceUDPSocketStatuses.connected;
                this.emit("connected", { ip, port });
            }
        });
    };

    /**
     * @description Удаляем UDP подключение
     * @returns void
     * @private
     */
    private reset = () => {
        if (this.socket) {
            try {
                this.socket.disconnect?.();
                this.socket.close?.();
            } catch (err) {
                if (err instanceof Error && err.message.includes("Not running")) return;
            }
        }

        this.socket = null;
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован
     * @returns void
     * @public
     */
    public destroy = () => {
        if (this._status === "disconnected") return;
        this._status = VoiceUDPSocketStatuses.disconnected;

        this?.removeAllListeners();
        this.socket?.removeAllListeners();
        super.destroy();

        this._heartbeat.stop();
        this._heartbeat.destroy();
        this._heartbeat = null;

        this.keepAlive.buffer = null;
        this.keepAlive = null;
        this.reset();
    };
}

/**
 * @author SNIPPIK
 * @description События для UDP
 * @interface UDPSocketEvents
 * @public
 */
export interface UDPSocketEvents {
    /**
     * @description Событие при котором сокет получает ответ от сервера
     * @param message - Само сообщение
     */
    readonly "message": (message: Buffer) => void;

    /**
     * @description Событие при котором сокет получает ошибку
     * @param error - Ошибка
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет закрывается
     */
    readonly "close": () => void;

    /**
     * @description Событие при котором будет возращены данные для подключения
     */
    readonly "connected": (info: { ip: string; port: number; }) => void;
}

/**
 * @author SNIPPIK
 * @description Состояния подключения
 * @enum VoiceUDPSocketStatuses
 */
enum VoiceUDPSocketStatuses {
    connected = "connected",
    connecting = "connecting",
    disconnected = "disconnected",
}