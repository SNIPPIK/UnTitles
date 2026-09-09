import { type WebSocketOpcodes } from "#core/voice/index.js";
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
     */
    public get status() {
        return this._status;
    };

    /**
     * Количество пакетов, ожидающих отправки в Rust-очереди.
     * Полезно для мониторинга нагрузки и отладки.
     * @return number
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
     * @public
     */
    public packet = (packet: Buffer[]): void => {
        try {
            this.socket.pushPackets(packet);
        } catch (error) {
            // Если не удалось отправить пакет или пакеты в rust слой
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
    public discovery = (ssrc: number): Buffer[] => {
        return this.socket.discovery(ssrc);
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
     * входящие пакеты и вызывает функцию для каждого сообщения.
     * @public
     */
    public connect = (options: WebSocketOpcodes.ready["d"]): void => {
        this.options = options;

        // Если уже есть UDP подключение
        if (this.socket) this.reset();

        this.socket = new UDPSocket(`${options.ip}:${options.port}`);
        this._status = VoiceUDPSocketStatuses.connecting; // Устанавливаем статус подключения

        // Rust создаст отдельный поток и будет вызывать для каждого полученного пакета
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
            const address = msg.subarray(8, msg.indexOf(0, 8)).toString("utf8");
            const port = msg.readUInt16BE(msg.length - 2);

            if (!isIPv4(address)) {
                // Если не удалось получить IPv4
                this.emit("discovery", Error("Not found IPv4 address"));
            } else {
                // Если данные для подключения были получены
                this._status = VoiceUDPSocketStatuses.connected;
                this.emit("discovery", { address, port });
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
        // Если есть UDP подключение
        if (this.socket) {
            this.socket.stopListening();
            this.socket.destroy();
        }

        // Чистим данные о подключении
        this.socket = null;
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
        this.reset(); // Удаляем UDP
        super.destroy(); // Удаляем TypedEmitter

        if (this._status === VoiceUDPSocketStatuses.disconnected) return;
        this._status = VoiceUDPSocketStatuses.disconnected;
    };
}

/**
 * @author SNIPPIK
 * @description Состояния подключения UDP-сокета
 * @enum VoiceUDPSocketStatuses
 */
enum VoiceUDPSocketStatuses {
    /** UDP соединение установлено | установлено активное соединение, можно отправлять и принимать данные */
    connected = "connected",

    /** UDP соединение еще устанавливается | сокет создан, но discovery-пакет ещё не обработан*/
    connecting = "connecting",

    /** UDP соединение разорвано | сокет уничтожен, все ресурсы освобождены */
    disconnected = "disconnected"
}

/**
 * @author SNIPPIK
 * @description События, которые может генерировать `VoiceUDPSocket`
 * @interface UDPSocketEvents
 * @public
 */
export interface UDPSocketEvents {
    /** Получен обычный UDP-пакет (например, аудио) */
    readonly "message": (message: Buffer) => void;

    /** Получен discovery-пакет (передаётся объект с IP/port или ошибка) */
    readonly "discovery": (options: handshake | Error) => void;

    /** Произошла ошибка (например, при отправке) */
    readonly "error": (error: Error) => void;

    /** Сокет закрыт (вызывается после `destroy`) */
    readonly "close": () => void;
}

/**
 * @author SNIPPIK
 * @description Данные для подключения по UDP
 * @interface handshake
 * @public
 */
export interface handshake {
    /** Адрес UDP подключения */
    address: string;

    /** Порт для подключения */
    port: number;
}