import {TypedEmitter} from "tiny-typed-emitter";
import {createSocket, Socket} from "node:dgram";
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
    private readonly socket: Socket = createSocket("udp4");

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
        ip: null,

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
        this.socket.send(packet, this.remote.port, this.remote.ip);
    };

    /**
     * @description Создает новый голосовой UDP-сокет.
     * @param options - Данные для подключения
     * @public
     */
    public constructor(options: VoiceUDPSocket["remote"]) {
        super();
        Object.assign(this.remote, options);

        // Добавляем ивенты
        for (let event of ["message", "error", "close"]) {
            this.socket.on(event, (...args) => this.emit(event as any, ...args));
        }
    };

    /**
     * @description Получаем IP-адрес и порт
     * @param ssrc -
     * @public
     */
    public getIPDiscovery = (ssrc: number): Promise<VoiceUDPSocket["remote"]> => {
        const discoveryBuffer = Buffer.alloc(74);
        discoveryBuffer.writeUInt16BE(1, 0);
        discoveryBuffer.writeUInt16BE(70, 2);
        discoveryBuffer.writeUInt32BE(ssrc, 4);
        this.packet = discoveryBuffer;

        // Передаем данные об IP-адресе и порте
        return new Promise((resolve, reject) => {
            this.socket
                .once("close", () => {
                    return reject(new Error("It is not possible to open the UDP port on your IP\n - Check your firewall!"))
                })
                .once("message", (msg) => {
                    if (msg.readUInt16BE(0) !== 2) return resolve(null);

                    try {
                        const packet = Buffer.from(msg);
                        const ip = packet.subarray(8, packet.indexOf(0, 8)).toString("utf8");

                        // Если нет IPv4
                        if (!isIPv4(ip)) return reject(new Error("Not found IPv4 address"));

                        return resolve({ip, port: packet.readUInt16BE(packet.length - 2)});
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
        if (this.socket) this.socket?.close();
    };
}

/**
 * @description Ивенты для UDP
 * @class VoiceWebSocket
 */
interface UDPSocketEvents {
    "message": (message: Buffer) => void;
    "error": (error: Error) => void;
    "close": () => void;
}