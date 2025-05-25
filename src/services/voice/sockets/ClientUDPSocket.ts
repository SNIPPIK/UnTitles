import { createSocket } from "node:dgram";
import { TypedEmitter } from "@utils";
import { isIPv4 } from "node:net";

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
 * @description Создает udp подключение к Discord Gateway
 * @class ClientUDPSocket
 * @public
 */
export class ClientUDPSocket extends TypedEmitter<UDPSocketEvents> {
    /**
     * @description Уничтожен ли класс
     * @private
     */
    private destroyed = false;

    /**
     * @description Socket UDP подключения
     * @readonly
     * @private
     */
    private readonly socket = createSocket({ type: "udp4" });

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
    private readonly keepAliveBuffer: Buffer = Buffer.alloc(4);

    /**
     * @description Счетчика активности
     * @private
     */
    private keepAliveCounter = 0;

    /**
     * @description Данные подключения
     * @public
     */
    public _discovery = {
        ip: null as string,
        port: 0
    };

    /**
     * @description Отправка данных на сервер
     * @param packet - Отправляемый пакет
     */
    public set packet(packet: Buffer) {
        this.socket.send(packet, 0, packet.length, this.options.port, this.options.ip, (err) => {
            if (err) this.emit("error", err);
        });
    };

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param options - Данные для подключения
     * @public
     */
    public constructor(private options: UDPConnection) {
        super();

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
     * @description Подключаемся к серверу через UDP подключение
     * @public
     */
    public discovery = (ssrc: number) => {
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

                this._discovery = { ip, port }
                this.emit("connected", { ip, port });
            }
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
     * @description Функция для предотвращения разрыва UDP подключения
     * @private
     */
    private keepAlive = () => {
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
        if (this.destroyed) return;
        this.destroyed = true;

        // Уничтожаем интервал активности
        clearInterval(this.keepAliveInterval);

        try {
            this.socket.close();
        } catch (err) {
            if (err instanceof Error && err.message.includes("Not running")) return;
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