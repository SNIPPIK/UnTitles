import { type WebSocketOpcodes } from "#core/voice";
import { type iType, UDPSocket } from "#native";
import { TypedEmitter } from "#structures";
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
    private socket: iType<typeof UDPSocket>;

    /** Данные подключения, полные данные пакета ready.d */
    public options: WebSocketOpcodes.ready["d"];

    /**
     * @description Получаем текущий статус подключения
     * @public
     */
    public get status() {
        return this._status;
    };

    /**
     * @description Кол-во пакетов в системе rust
     * @public
     */
    public get packets() {
        return this.socket.packets;
    };

    /**
     * @description Отправка данных на сервер через Rust
     * @public
     */
    public packet(packet: Buffer) {
        try {
            this.socket.pushPacket(packet);
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * @description Подключаемся и запускаем цикл прослушивания
     * @public
     */
    public connect = (options: WebSocketOpcodes.ready["d"]) => {
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
     * @private
     */
    private handleMessage(msg: Buffer) {
        // Логика Discovery
        if (msg && msg.length === 74 && msg.readUInt16BE(0) === 2) {
            const ip = msg.subarray(8, msg.indexOf(0, 8)).toString("utf8");
            const port = msg.readUInt16BE(msg.length - 2);

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
        return packet;
    };

    /**
     * @description Удаляем UDP подключение
     * @returns void
     * @private
     */
    private reset = () => {
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