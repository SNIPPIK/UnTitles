import { createSocket, type Socket } from "node:dgram";
import { type WebSocketOpcodes } from "#core/voice";
import { TypedEmitter } from "#structures";
import { isIPv4 } from "node:net";

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

    /** Данные подключения, полные данные пакета ready.d */
    public options: WebSocketOpcodes.ready["d"];

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     * @public
     */
    public set packet(packet: Buffer) {
        // Отправляем аудио или буфер пакет
        this.socket.send(packet, 0, packet.length, this.options.port, this.options.ip, (err) => {
            if (err) this.emit("error", err);
        });
    };

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
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
        });

        socket.on("error", this.emit.bind(this, "error"));
        socket.on("message", this.emit.bind(this, "message"));

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
    public discovery = async (ssrc: number): Promise<Error | {ip: string; port: number}> => {
        const packet = Buffer.allocUnsafe(74);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        this.packet = packet;
        this._status = VoiceUDPSocketStatuses.connecting;

        return new Promise((resolve) => {
            // Ждем получения сообщения после отправки код, для подключения UDP
            this.socket.once("message", (packet) => {
                if (packet.readUInt16BE(0) === 2) {
                    const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");
                    const port = packet.readUInt16BE(packet.length - 2);

                    // Если провайдер не предоставляет или нет пути IPV4
                    if (!isIPv4(ip)) return resolve(Error("Not found IPv4 address"));

                    this._status = VoiceUDPSocketStatuses.connected;
                    return resolve({ip, port})
                }

                return resolve(Error("Failed to connect from UDP protocol"));
            });
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
 */
enum VoiceUDPSocketStatuses {
    connected = "connected",
    connecting = "connecting",
    disconnected = "disconnected",
}