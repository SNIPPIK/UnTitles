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
     * Возвращает количество пакетов, ожидающих отправки в Rust-очереди.
     * Полезно для мониторинга нагрузки и отладки.
     *
     * @returns Количество пакетов, либо `0`, если сокет не создан.
     */
    public get packets() {
        // Если сокет уничтожен (null) — возвращаем 0.
        return Number(this.socket?.packets ?? 0);
    };

    /**
     * Возвращает количество пакетов, потерянных со стороны клиента.
     * Учитываются переполнения очереди и временные ошибки отправки.
     *
     * @returns Число отброшенных пакетов.
     */
    public get drops() {
        return this.socket.drops;
    };

    /**
     * Отправляет один или несколько пакетов через Rust-сокет.
     *
     * Пакеты буферизируются на стороне Rust и отправляются в фоновом потоке.
     * Метод не блокирует выполнение и не ждёт подтверждения отправки.
     *
     * @param packet - массив `Buffer` с данными для отправки. Пустые массивы игнорируются.
     *
     * @remarks
     * При ошибке (например, переполнение внутренней очереди Rust) генерирует событие `error`.
     */
    public packet = (packet: Buffer[]): void => {
        try {
            // Передаём пакеты в Rust-слой для буферизации и отправки.
            this.socket.pushPackets(packet);
        } catch (error) {
            // Ошибка FFI или внутренняя ошибка Rust — эмитим наружу.
            this.emit("error", error as Error);
        }
    };

    /**
     * Формирует discovery-пакет для запроса внешнего IP и порта.
     * Rust-слой сам поставит пакет в очередь и отправит.
     *
     * @param ssrc - SSRC-идентификатор из WebSocket-сессии, необходимый для идентификации потока.
     */
    public discovery = (ssrc: number): void => {
        // Rust сформирует и отправит discovery-пакет.
        this.socket.discovery(ssrc);
    };

    /**
     * Инициализирует RTP.
     *
     * Вызывается после получения голосового ключа от Discord.
     * Повторный вызов при подключении безопасен, просто пересоздаст данные и AES
     *
     * @param ssrc - идентификатор источника синхронизации.
     * @param key - 32-байтный ключ AES-256-GCM.
     */
    public initialize_rtp = (ssrc: number, key: Array<number>): void => {
        this.socket.initialize_rtp(ssrc, key);
    };

    /**
     * Инициализирует UDP-сокет и запускает приём входящих пакетов.
     *
     * @param options - данные из WebSocket-события `ready` (IP, порт и прочее).
     *
     * @remarks
     * Если сокет уже существовал, он уничтожается через `reset()` перед созданием нового.
     * После создания запускается фоновый поток Rust, который вызывает `handleMessage`
     * для каждого полученного пакета.
     */
    public connect = (options: WebSocketOpcodes.ready["d"]): void => {
        // Сохраняем параметры подключения.
        this.options = options;

        // Если уже есть активный сокет — освобождаем ресурсы.
        if (this.socket) this.reset();

        // Создаём новый Rust-сокет, подключённый к полученному адресу.
        this.socket = new UDPSocket(`${options.ip}:${options.port}`);
        // Помечаем статус «устанавливается соединение».
        this._status = VoiceUDPSocketStatuses.connecting;

        // Запускаем фоновый поток приёма.
        this.socket.startListening(this.handleMessage);
    };

    /**
     * Обрабатывает входящие UDP-пакеты.
     *
     * Различает два типа сообщений:
     * 1. Discovery-пакет (длина 74 байта, первые два байта = 0x0002) — содержит IP и порт
     *    для P2P-соединения. При получении эмитит событие `discovery` с найденным адресом.
     * 2. Любые другие пакеты (например, аудио) — пробрасываются через событие `message`.
     *
     * @param msg - полученный буфер данных.
     * @private
     */
    private handleMessage = (msg: Buffer): void => {
        // Проверка discovery-пакета (RFC для Discord Voice).
        if (msg && msg.length === 74 && msg.readUInt16BE(0) === 2) {
            // Читаем строку адреса, начиная с 8-го байта до первого нуля.
            const address = msg.subarray(8, msg.indexOf(0, 8)).toString("utf8");
            // Порт записан в последних двух байтах.
            const port = msg.readUInt16BE(msg.length - 2);

            // Проверяем, что адрес является корректным IPv4.
            if (!isIPv4(address)) {
                // Если адрес невалиден — эмитим ошибку.
                this.emit("discovery", Error("Not found IPv4 address"));
            } else {
                // Устанавливаем статус «соединение установлено».
                this._status = VoiceUDPSocketStatuses.connected;
                // Публикуем адрес и порт.
                this.emit("discovery", { address, port });
            }
            return;
        }

        // Любое другое сообщение пробрасываем наружу без обработки.
        this.emit("message", msg);
    }

    /**
     * Принудительно уничтожает текущий Rust-сокет и освобождает ресурсы.
     *
     * Используется перед повторным созданием сокета или при полном закрытии.
     * Безопасен для повторного вызова.
     *
     * @private
     */
    private reset = () => {
        // Если сокет существует — останавливаем слушателя и уничтожаем.
        if (this.socket) {
            this.socket.stopListening();
            this.socket.destroy();
        }

        // Обнуляем ссылку на сокет.
        this.socket = null;
    };

    /**
     * Полностью закрывает UDP-сокет и переводит его в состояние `disconnected`.
     *
     * @remarks
     * Если статус уже `disconnected`, вызов игнорируется. После уничтожения
     * эмитится событие `close` (унаследованное от `TypedEmitter`).
     * Экземпляр после вызова не предназначен для повторного использования.
     */
    public destroy = () => {
        // Уничтожаем UDP-сокет.
        this.reset();
        // Убираем всех слушателей базового TypedEmitter.
        super.destroy();

        // Если уже отключены — выходим.
        if (this._status === VoiceUDPSocketStatuses.disconnected) return;
        // Помечаем состояние как отключённое.
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