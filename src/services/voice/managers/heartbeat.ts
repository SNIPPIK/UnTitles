/**
 * @author SNIPPIK
 * @description Время ожидания получения ask кода до переподключения
 * @const timeout
 * @private
 */
const timeout = 5e3;

/**
 * @author SNIPPIK
 * @description Класс, управляющий логикой Heartbeat соединения
 * Включает интервал отправки, контроль ACK, количество пропусков и перезапуск
 * @class HeartbeatManager
 */
export class HeartbeatManager {
    /** Таймер для отправки heartbeat */
    private interval?: NodeJS.Timeout;

    /** Таймер для ожидания ответа ACK */
    private timeout?: NodeJS.Timeout;

    /** Последнее время получения ACK */
    private lastAckTime = 0;

    /** Последнее время отправки heartbeat */
    private lastSentTime = 0;

    /** Количество пропущенных ACK */
    private misses = 0;

    /** Количество переподключений подряд */t
    private reconnects = 0;

    /** Интервал между heartbeat-сообщениями */
    public intervalMs = 0;

    /**
     * @description Получаем текущую задержку между send → ack
     * @public
     */
    public get latency() {
        return this.lastAckTime - this.lastSentTime;
    };

    /**
     * @description Получаем количество подряд пропущенных ACK
     * @public
     */
    public get missed() {
        return this.misses;
    };

    /**
     * @description Получаем количество подрядных попыток переподключения
     * @public
     */
    public get reconnectAttempts() {
        return this.reconnects;
    };

    /**
     * @param hooks - Объект с внешними методами: send, onTimeout, onAck
     * @public
     */
    public constructor(private readonly hooks: HeartbeatHooks) {}

    /**
     * @description Запускаем heartbeat с заданным интервалом
     * @param intervalMs - Время между heartbeat (в мс)
     * @public
     */
    public start = (intervalMs?: number) => {
        this.stop(); // останавливаем старый таймер если есть
        if (intervalMs) this.intervalMs = intervalMs;

        // Устанавливаем интервал отправки heartbeat
        this.interval = setInterval(() => {
            this.lastSentTime = Date.now();
            this.hooks.send(); // отправляем heartbeat
            this.setTimeout(); // запускаем ожидание ack
        }, this.intervalMs);
    };

    /**
     * @description Запускаем таймер ожидания ACK после каждого heartbeat
     * Если ACK не получен, вызывается onTimeout
     * @private
     */
    private setTimeout = () => {
        if (this.timeout) clearTimeout(this.timeout);

        this.timeout = setTimeout(() => {
            this.misses++;
            this.hooks.onTimeout(); // вызываем внешний обработчик
        }, timeout); // небольшой запас, чтобы не ложно триггерить
    };

    /**
     * @description Обработка получения ACK
     * @public
     */
    public ack = () => {
        this.lastAckTime = Date.now();
        const latency = this.lastAckTime - this.lastSentTime;

        this.misses = 0;
        if (this.timeout) clearTimeout(this.timeout);

        this.hooks.onAck(latency); // передаём задержку наружу
    };

    /**
     * @description Останавливаем все heartbeat процессы
     * @public
     */
    public stop = () => {
        if (this.interval) clearInterval(this.interval);
        if (this.timeout) clearTimeout(this.timeout);

        this.interval = undefined;
        this.timeout = undefined;
        this.misses = 0;
    };

    /**
     * @description Сбросить счётчик reconnect'ов
     * @public
     */
    public resetReconnects = () => {
        this.reconnects = 0;
    };

    /**
     * @description Увеличить счётчик reconnect'ов (на 1)
     * @public
     */
    public increaseReconnect = () => {
        this.reconnects++;
    };
}

/**
 * @author SNIPPIK
 * @description Функции для прямого общения классов
 * @type HeartbeatHooks
 */
type HeartbeatHooks = {
    /**
     * @description Метод вызывается при необходимости отправки heartbeat-пакета
     * @readonly
     * @private
     */
    readonly send: () => void;

    /**
     * @description Метод вызывается, если не получен HEARTBEAT_ACK вовремя
     * @readonly
     * @private
     */
    readonly onTimeout: () => void;

    /**
     * @description Метод вызывается при получении HEARTBEAT_ACK
     * @param latency - Задержка между отправкой и получением ack
     * @readonly
     * @private
     */
    readonly onAck: (latency: number) => void;
};