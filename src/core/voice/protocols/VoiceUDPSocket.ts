import { type WebSocketOpcodes } from "#core/voice";
import { TypedEmitter } from "#structures";
import { UDPSocket } from "#native";
import { isIPv4 } from "node:net";

/**
 * @author SNIPPIK
 * @description Полностью нативное UDP подключение через Rust
 * @class VoiceUDPSocket
 * @extends TypedEmitter
 * @public
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    private _status: VoiceUDPSocketStatuses;

    /** Socket UDP подключения */
    private socket: UDPSocket;

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
     * @description Отправка данных на сервер через Rust
     */
    public packet(packet: Buffer) {
        if (!this.socket) return;

        try {
            this.socket.pushPacket(packet);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Подключаемся и запускаем цикл прослушивания
     */
    public connect = (options: WebSocketOpcodes.ready["d"]) => {
        if (this.options && options.ip === this.options.ip && options.port === this.options.port) return;

        // Меняем данные
        this.options = options;
        if (this.socket) this.reset();

        this.socket = new UDPSocket(`${options.ip}:${options.port}`);
        this._status = VoiceUDPSocketStatuses.connecting;

        // Rust сам создаст поток и будет вызывать этот колбэк
        this.socket.startListening((msg: Buffer) => {
            this.handleMessage(msg);
        });
    };

    /**
     * @description Цикл опроса нативного сокета
     */
    private handleMessage(msg: Buffer) {
        // Логика Discovery
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
    }

    /**
     * @description Просим указать путь до конечной точки
     * @returns void
     * @public
     */
    public discovery = (ssrc: number): Buffer => {
        const packet = Buffer.alloc(74, 0);
        packet.writeUInt16BE(1, 0);
        packet.writeUInt16BE(70, 2);
        packet.writeUInt32BE(ssrc, 4);

        // Запускаем таймер ожидания
        if (this.discoveryTimeout) clearTimeout(this.discoveryTimeout);

        this.discoveryTimeout = setTimeout(() => {
            // Значит подключение удалось!
            if (this._status === VoiceUDPSocketStatuses.connected) return;
            this.destroy();
            this.emit("error", new Error("IP Discovery timed out after 5 seconds"));
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
        this.socket.destroy();
        this.socket = null;
    };

    /**
     * @description Закрывает сокет, экземпляр не сможет быть повторно использован
     * @returns void
     * @public
     */
    public destroy = () => {
        if (this._status === VoiceUDPSocketStatuses.disconnected) return;
        this._status = VoiceUDPSocketStatuses.disconnected;
        this.reset();
        super.destroy();
    };
}

/**
 * @author SNIPPIK
 * @description Состояния подключения
 */
enum VoiceUDPSocketStatuses {
    connected = "connected",
    connecting = "connecting",
    disconnected = "disconnected",
}

export interface UDPSocketEvents {
    readonly "message": (message: Buffer) => void;
    readonly "discovery": (options: {ip: string; port: number} | Error) => void;
    readonly "error": (error: Error) => void;
    readonly "close": () => void;
}