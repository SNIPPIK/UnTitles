import { type WebSocketOpcodes } from "#core/voice";
import { type iType, UDPSocket } from "#native";
import { TypedEmitter } from "#structures";
import { isIPv4 } from "node:net";

/**
 * Полностью нативное UDP подключение через Rust.
 *
 * Класс инкапсулирует работу с UDP-сокетом, реализованным на Rust (через N-API).
 * Он управляет жизненным циклом подключения, отправкой и приёмом пакетов,
 * а также обработкой discovery-пакетов для установления P2P-соединения.
 *
 * Событийная модель наследуется от `TypedEmitter`, что позволяет подписываться
 * на входящие сообщения, ошибки, discovery и закрытие.
 *
 * @remarks
 * Все сетевые операции (отправка, приём, буферизация) выполняются на стороне Rust
 * в отдельных потоках, что обеспечивает высокую производительность и не блокирует
 * цикл событий Node.js. JavaScript-слой только передаёт данные и реагирует на события.
 *
 * @example
 * ```ts
 * const udp = new VoiceUDPSocket();
 * udp.on('discovery', (info) => console.log('IP:', info.ip, 'Port:', info.port));
 * udp.on('message', (buffer) => console.log('Received:', buffer));
 * udp.connect(readyData);
 * ```
 *
 * @public
 */
export class VoiceUDPSocket extends TypedEmitter<UDPSocketEvents> {
    /** Текущий статус UDP подключения **/
    private _status: VoiceUDPSocketStatuses = VoiceUDPSocketStatuses.disconnected;

    /** Rust-сокет, обеспечивающий низкоуровневую отправку/приём UDP-пакетов */
    private socket: iType<typeof UDPSocket> | null;

    /** Данные подключения, полученные через WebSocket (событие `ready`) */
    public options: WebSocketOpcodes.ready["d"];

    /**
     * Текущий статус подключения.
     * Возможные значения: `connecting`, `connected`, `disconnected`.
     *
     * @readonly
     */
    public get status() {
        return this._status;
    };

    /**
     * Количество пакетов, ожидающих отправки в Rust-очереди.
     * Полезно для мониторинга нагрузки и отладки.
     * @return number
     * @readonly
     */
    public get packets() {
        // Обработка случая, когда сокет уничтожен (null)
        return Number(this.socket?.packets ?? 0);
    };

    /**
     * Кол-во утерянный пакетов со стороны клиента
     * @return number
     * @public
     */
    public get drops() {
        return this.socket.drops;
    };

    /**
     * Отправляет один или несколько пакетов данных через Rust-сокет.
     *
     * Пакеты буферизируются на стороне Rust и отправляются в фоновом потоке.
     * Метод не блокирует выполнение и не ждёт подтверждения отправки.
     *
     * @param packet - Пакет или массив пакетов (`Buffer` или `Uint8Array`).
     *                 Пустые массивы игнорируются.
     *
     * @throws Не выбрасывает ошибку напрямую, но при ошибке (например, переполнение
     *         внутренней очереди Rust) генерирует событие `error`.
     *
     * @public
     *
     * @example
     * // Отправить один пакет
     * socket.packet(opusFrame);
     *
     * @example
     * // Отправить несколько пакетов за раз
     * socket.packet([frame1, frame2, frame3]);
     */
    public packet = (packet: Buffer[] | Buffer): void => {
        try {
            const list = Array.isArray(packet) ? packet : [packet];
            if (list.length > 0 && this.socket) {
                this.socket.pushPackets(list);
            }
        } catch (error) {
            this.emit("error", error as Error);
        }
    };

    /**
     * Формирует discovery-пакет для запроса внешнего IP и порта.
     *
     * @param ssrc - SSRC идентификатор (из WebSocket-сессии), необходимый для идентификации потока.
     * @returns Буфер, готовый к отправке через UDP-сокет.
     * @public
     */
    public discovery = (ssrc: number): Buffer => {
        const packet = Buffer.alloc(74, 0);
        packet.writeUInt16BE(1, 0);   // тип 1 (discovery)
        packet.writeUInt16BE(70, 2);  // длина 70 байт (всего 74)
        packet.writeUInt32BE(ssrc, 4);
        return packet;
    };

    /**
     * Инициализирует UDP-сокет и начинает прослушивание входящих пакетов.
     *
     * @param options - данные из WebSocket-события `ready`, содержащие IP и порт сервера,
     *                  а также дополнительную информацию для подключения.
     *
     * @remarks
     * Если сокет уже существовал, он будет уничтожен (`reset()`) перед созданием нового.
     * Сразу после создания сокета запускается внутренний поток Rust, который слушает
     * входящие пакеты и вызывает переданный колбэк для каждого сообщения.
     *
     * @public
     */
    public connect = (options: WebSocketOpcodes.ready["d"]): void => {
        this.options = options;
        if (this.socket) this.reset();

        this.socket = new UDPSocket(`${options.ip}:${options.port}`);
        this._status = VoiceUDPSocketStatuses.connecting;

        // Rust создаст отдельный поток и будет вызывать этот колбэк для каждого полученного пакета
        this.socket.startListening(this.handleMessage);
    };

    /**
     * Обрабатывает входящие UDP-пакеты.
     *
     * Различает два типа сообщений:
     * 1. Discovery-пакет (длина 74 байта, первые два байта = 0x0002) — содержит IP и порт
     *    для P2P-соединения. При его получении генерируется событие `discovery` с найденным адресом.
     * 2. Обычные пакеты (например, аудиоданные) — пробрасываются через событие `message`.
     *
     * @param msg - полученный буфер данных.
     * @private
     */
    private handleMessage = (msg: Buffer): void => {
        // Проверка discovery-пакета (RFC для Discord Voice)
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

        // Любое другое сообщение передаём наружу
        this.emit("message", msg);
    }

    /**
     * Принудительно уничтожает текущий Rust-сокет и освобождает его ресурсы.
     * Используется перед повторным созданием сокета или при полном закрытии.
     *
     * @private
     */
    private reset = () => {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    };

    /**
     * Полностью закрывает UDP-сокет. После вызова экземпляр не может быть использован повторно.
     *
     * @remarks
     * Если статус уже `disconnected`, вызов игнорируется. После уничтожения генерируется
     * событие `close` (унаследованное от `TypedEmitter`).
     *
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
 * Состояния подключения UDP-сокета.
 *
 * - `connected`: установлено активное соединение, можно отправлять и принимать данные.
 * - `connecting`: сокет создан, но discovery-пакет ещё не обработан.
 * - `disconnected`: сокет уничтожен, все ресурсы освобождены.
 */
enum VoiceUDPSocketStatuses {
    connected = "connected",
    connecting = "connecting",
    disconnected = "disconnected",
}

/**
 * События, которые может генерировать `VoiceUDPSocket`.
 *
 * - `message`: получен обычный UDP-пакет (например, аудио).
 * - `discovery`: получен discovery-пакет (передаётся объект с IP/port или ошибка).
 * - `error`: произошла ошибка (например, при отправке).
 * - `close`: сокет закрыт (вызывается после `destroy`).
 */
export interface UDPSocketEvents {
    readonly "message": (message: Buffer) => void;
    readonly "discovery": (options: { ip: string; port: number } | Error) => void;
    readonly "error": (error: Error) => void;
    readonly "close": () => void;
}