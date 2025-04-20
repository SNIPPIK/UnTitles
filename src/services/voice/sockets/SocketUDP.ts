import {UDPSocketEvents} from "@service/voice";
import {createSocket} from "node:dgram";
import {TypedEmitter} from "@utils";
import {isIPv4} from "node:net";


/**
 * @author SNIPPIK
 * @description Интервал в миллисекундах, с которым отправляются датаграммы поддержания активности
 * @private
 */
const ALIVE_INTERVAL = 5e3;

/**
 * @author SNIPPIK
 * @description Максимальное значение счетчика активности
 * @private
 */
const MAX_SIZE_VALUE = 2 ** 32 - 1;

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
    private readonly socket = createSocket({ type: "udp4" });

    /**
     * @description Данные сервера к которому надо подключится
     * @readonly
     * @private
     */
    public readonly _connection: UDPConnection;

    /**
     * @description Интервал для предотвращения разрыва
     * @readonly
     * @private
     */
    private readonly keepAliveInterval: NodeJS.Timeout;

    /**
     * @description Буфер, используемый для записи счетчика активности
     * @readonly
     * @private
     */
    private readonly keepAliveBuffer: Buffer = Buffer.alloc(8);

    /**
     * @description Счетчика активности
     * @private
     */
    private keepAliveCounter = 0;

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     */
    public set packet(packet: Buffer) {
        this.socket.send(packet, this._connection.port, this._connection.ip, (err) => {
            if (err) this.emit("error", err);
        });
    };

    /**
     * @description Подключаемся к серверу через UDP подключение
     * @public
     */
    public set discovery(ssrc: number) {
        this.packet = this.discoveryBuffer(ssrc);

        this.socket.once("message", (message) => {
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
        this.socket.on("error", async (err) => {
            this.emit("error", err);
        });

        // Если подключение оборвалось
        this.socket.on("close", async () => {
            this.emit("close");
        });

        // Запускаем интервал
        this.keepAliveInterval = setInterval(this.keepAlive, ALIVE_INTERVAL);
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
     * @description Функция для предотвращения разрыва UDP подключения
     * @private
     */
    private keepAlive = () => {
        this.keepAliveBuffer.writeUInt32LE(this.keepAliveCounter, 0);
        this.packet = this.keepAliveBuffer;
        this.keepAliveCounter++;

        if (this.keepAliveCounter > MAX_SIZE_VALUE) {
            this.keepAliveCounter = 0;
        }
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован.
     * @public
     */
    public destroy = () => {
        // Уничтожаем интервал активности
        clearInterval(this.keepAliveInterval);

        try {
            this.socket.close();
        } catch (err) {
            if (`${err}`.match("Not running")) return;
        }

        this.socket.removeAllListeners();
        this.removeAllListeners();
    };
}

/**
 * @author SNIPPIK
 * @description Параметры подключения UDP
 * @interface UDPConnection
 * @private
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