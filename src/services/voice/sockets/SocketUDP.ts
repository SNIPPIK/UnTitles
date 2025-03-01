import {createSocket, Socket} from "node:dgram";
import {Encryption} from "@service/voice";
import {TypedEmitter} from "@utils";
import {Buffer} from "node:buffer";
import {isIPv4} from "node:net";

/**
 * @author SNIPPIK
 * @description Создает udp подключение к api discord
 * @class VoiceUDPSocket
 * @public
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    /**
     * @description Socket UDP подключения
     * @readonly
     * @private
     */
    private readonly socket: Socket = createSocket({ type: "udp4" });

    /**
     * @description Данные сервера к которому надо подключится
     * @readonly
     * @private
     */
    private readonly remote = {
        /**
         * @description Прямой ip сервера
         * @private
         */
        ip: null as string,

        /**
         * @description Порт сервера
         * @private
         */
        port: 443
    };

    /**
     * @description Отправляем буфер в Discord
     * @param packet - Буфер для отправки
     * @public
     */
    public set packet(packet: Buffer) {
        // Если есть пакет
        if (packet) this.socket.send(packet, this.remote.port, this.remote.ip);
    };

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param options - Данные для подключения
     * @public
     */
    public constructor(options: VoiceUDPSocket["remote"]) {
        super();
        this.remote = { ...this.remote, ...options };

        // Привязываем события
        for (let event of ["message", "error", "close"]) {
            this.socket.on(event, (...args) => this.emit(event as any, ...args));
        }
    };

    /**
     * @description Получаем IP-адрес и порт
     * @param ssrc -
     * @public
     */
    public discovery = (ssrc: number): Promise<VoiceUDPSocket["remote"]> => {
        this.packet = Encryption.discoveryBuffer(ssrc);

        // Передаем данные об IP-адресе и порте
        return new Promise((resolve, reject) => {
            this.socket

                // Если при подключении была получена ошибка
                .once("error", (err) => {
                    if (err) console.error(err);
                    return reject(Error("It is not possible to open the UDP port on your IP\n - Check your firewall!"));
                })

                // Если получен ответ от сервера
                .once("message", (message) => {
                    if (message.readUInt16BE(0) !== 2) return resolve(null);

                    try {
                        const packet = Buffer.from(message);
                        const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");

                        // Если провайдер не предоставляет или нет пути IPV4
                        if (!isIPv4(ip)) return reject(Error("Not found IPv4 address"));

                        return resolve({
                            ip,
                            port: packet.readUInt16BE(packet.length - 2)
                        });
                    } catch {
                        return resolve(null);
                    }
                });
        });
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован.
     * @public
     */
    public destroy = () => {
        try {
            if (this.socket) this.socket?.close();
        } catch (err) {
            if (`${err}`.match("Not running")) return;
        }
    };
}

/**
 * @author SNIPPIK
 * @description События для UDP
 * @class VoiceWebSocket
 */
interface UDPSocketEvents {
    /**
     * @description Событие при котором сокет получает ответ от сервера
     * @param message - Само сообщение
     */
    readonly "message": (message: Buffer) => void;

    /**
     * @description Событие при котором сокет получает ошибку
     * @param error
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет закрывается
     */
    readonly "close": () => void;
}