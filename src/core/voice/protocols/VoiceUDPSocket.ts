import { createSocket, type Socket } from "node:dgram";
import { type WebSocketOpcodes } from "#core/voice";
import { TypedEmitter } from "#structures";
import { isIPv4 } from "node:net";

/**
 * @author SNIPPIK
 * @description Создает udp подключение к Discord Gateway
 * @class VoiceUDPSocket
 * @extends TypedEmitter
 * @public
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    /** Текущий статус */
    private _status: VoiceUDPSocketStatuses;

    /** Socket UDP подключения */
    private socket: Socket;

    /** Данные подключения, полные данные пакета ready.d */
    public options: WebSocketOpcodes.ready["d"];

    private discoveryTimeout?: NodeJS.Timeout;

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     * @public
     */
    public packet(packet: Buffer) {
        if (!this.socket) return;

        // Отправляем аудио или буфер пакет
        this.socket.send(packet, 0, packet.length, this.options.port, this.options.ip);
    };

    /**
     * @description Подключаемся по UDP подключению
     * @param options - Данные для подключения
     * @public
     */
    public connect = (options: WebSocketOpcodes.ready["d"]) => {
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
            type: isIPv4(options.ip) ? "udp4" : "udp6",
            sendBufferSize: 1024 * 1024 * 1024,
            recvBufferSize: 1024 * 1024 * 1024
        });
        // Позволяет процессу умереть, даже если сокет жив
        socket.unref();

        socket.on("error", this.emit.bind(this, "error"));
        socket.on("message", (msg) => {
            // Пакет discovery
            if (msg.length === 74 && msg.readUInt16BE(0) === 2) {
                const ip = msg.subarray(8, msg.indexOf(0, 8)).toString("utf8");
                const port = msg.readUInt16BE(msg.length - 2);

                if (this.discoveryTimeout) clearTimeout(this.discoveryTimeout);

                if (!isIPv4(ip)) {
                    this.emit("discovery", new Error("Not found IPv4 address"));
                } else {
                    this._status = VoiceUDPSocketStatuses.connected;
                    this.emit("discovery", { ip, port });
                }
                return;
            }

            // Отправляем данные через событие дальше
            this.emit("message", msg);
        });

        // Если подключение оборвалось
        socket.once("close", () => {
            this._status = VoiceUDPSocketStatuses.disconnected;
            this.emit("close");
        });
    };

    /**
     * @description Просим указать путь до конечной точки
     * @returns void
     * @public
     */
    public discovery = (ssrc: number): Buffer => {
        const packet = Buffer.allocUnsafe(74);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        // Запускаем таймер ожидания
        if (this.discoveryTimeout) clearTimeout(this.discoveryTimeout);

        this.discoveryTimeout = setTimeout(() => {
            // Значит подключение удалось!
            if (this._status === VoiceUDPSocketStatuses.connected) return;

            // Удаляем слушателя, чтобы не получить отложенный ответ
            this.socket.removeAllListeners("message");
            this.socket.removeAllListeners("error");

            this.destroy();
            throw Error("IP Discovery timed out after 5 seconds");
        }, 5000);

        this._status = VoiceUDPSocketStatuses.connecting;
        return packet;
    };

    /**
     * @description Удаляем UDP подключение
     * @returns void
     * @private
     */
    private reset = () => {
        if (this.discoveryTimeout) clearTimeout(this.discoveryTimeout);
        if (this.socket) {
            try {
                this.socket.removeAllListeners();
                this.socket.close();
            } catch {}
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

        super.destroy();
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
     * @readonly
     */
    readonly "message": (message: Buffer) => void;

    /**
     * @description Транспортный пакет, для получения адреса подключения
     * @param options - Может отдавать как ошибку так и данные
     * @readonly
     */
    readonly "discovery": (options: {ip: string; port: number} | Error) => void;

    /**
     * @description Событие при котором сокет получает ошибку
     * @param error - Ошибка
     * @readonly
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет закрывается
     * @readonly
     */
    readonly "close": () => void;
}

/**
 * @author SNIPPIK
 * @description Состояния подключения
 * @enum VoiceUDPSocketStatuses
 * @private
 */
enum VoiceUDPSocketStatuses {
    connected = "connected",
    connecting = "connecting",
    disconnected = "disconnected",
}