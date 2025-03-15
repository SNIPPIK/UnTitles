import {UDPSocketEvents} from "@service/voice";
import {createSocket} from "node:dgram";
import {TypedEmitter} from "@utils";
import {isIPv4} from "node:net";

/**
 * @author SNIPPIK
 * @description Создает udp подключение к api discord
 * @class SocketUDP
 * @public
 */
export class SocketUDP extends TypedEmitter<UDPSocketEvents> {
    /**
     * @description Socket UDP подключения
     * @readonly
     * @private
     */
    private readonly socket = createSocket({ type: "udp4", sendBufferSize: 500 });

    /**
     * @description Данные сервера к которому надо подключится
     * @readonly
     * @private
     */
    public readonly _connection: UDPConnection;

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     */
    public set packet(packet: Buffer) {
        this.socket.send(packet, this._connection.port, this._connection.ip);
    };

    /**
     * @description Подключаемся к серверу через UDP подключение
     * @public
     */
    public set discovery(ssrc: number) {
        this.packet = this.discoveryBuffer(ssrc);

        this.socket.once("message", async (message) => {
            if (message.readUInt16BE(0) === 2) {
                const packet = Buffer.from(message);
                const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");
                const port = packet.readUInt16BE(packet.length - 2);

                // Если провайдер не предоставляет или нет пути IPV4
                if (!isIPv4(ip)) {
                    this.emit("error", Error("Not found IPv4 address"));
                    return;
                }

                this.emit("connected", { ip, port });
                return;
            }
        });
    };

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param options - Данные для подключения
     * @public
     */
    public constructor(options: UDPConnection) {
        super();
        this._connection = options;

        // Если подключение возвращает ошибки
        this.socket.on("error", (err) => {
            this.emit("error", err);
        });

        // Если подключение оборвалось
        this.socket.once("close", () => {
            this.emit("close");
        });
    };

    /**
     * @description Пакет для создания UDP соединения
     * @public
     */
    private discoveryBuffer = (ssrc: number) => {
        const packet = Buffer.alloc(74);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        return packet;
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован.
     * @public
     */
    public destroy = () => {
        this.socket.removeAllListeners();

        try {
            if (this.socket) this.socket?.close();
        } catch (err) {
            if (`${err}`.match("Not running")) return;
        }
    };
}

/**
 * @author SNIPPIK
 * @description Параметры подключения UDP
 * @interface UDPConnection
 */
interface UDPConnection {
    /**
     * @description Прямой ip сервера
     * @private
     */
    ip: string,

    /**
     * @description Порт сервера
     * @private
     */
    port: number
}