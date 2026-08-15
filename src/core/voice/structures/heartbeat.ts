/**
 * @author SNIPPIK
 * @description Время ожидания получения ask кода до переподключения
 * @const timeout
 * @private
 */
const HEARTBEAT_TIMEOUT = 3e3;

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
    private lastSentTime = Date.now();

    /** Количество пропущенных ACK */
    private misses = 0;

    /** Интервал между heartbeat-сообщениями */
    public intervalMs = 0;

    /**
     * @description Получаем текущую задержку между send → ack
     * @public
     */
    public get latency() {
        return Math.max(0, this.lastAckTime - this.lastSentTime);
    };

    /**
     * @description Получаем количество подряд пропущенных ACK
     * @public
     */
    public get missed() {
        return this.misses;
    };

    /**
     * @param hooks - Объект с внешними методами: send, onTimeout, onAck
     * @constructor
     * @public
     */
    public constructor(private hooks: HeartbeatHooks) {};

    /**
     * @description Запускаем heartbeat с заданным интервалом
     * @param intervalMs - Время между heartbeat (в мс)
     * @returns void
     * @public
     */
    public start = (intervalMs?: number): void => {
        this.stop(); // останавливаем старый таймер если есть
        if (intervalMs) this.intervalMs = intervalMs;

        const timeout = ()=> {
            if (!this.intervalMs) return null;

            return setTimeout(() => {
                this.lastSentTime = Date.now();
                this.hooks?.send?.(this.lastSentTime, this.latency); // отправляем heartbeat
                this.setTimeout(); // запускаем ожидание ack
                return timeout();
            }, this.intervalMs);
        }

        // Устанавливаем интервал отправки heartbeat
        this.interval = timeout();
    };

    /**
     * @description Запускаем таймер ожидания ACK после каждого heartbeat
     * Если ACK не получен, вызывается onTimeout
     * @returns void
     * @private
     */
    private setTimeout = () => {
        if (this.timeout) clearTimeout(this.timeout);

        this.timeout = setTimeout(() => {
            this.misses++;
            this.hooks?.onTimeout(); // вызываем внешний обработчик
        }, HEARTBEAT_TIMEOUT); // небольшой запас, чтобы не ложно сработать
    };

    /**
     * @description Обработка получения ACK
     * @returns void
     * @public
     */
    public ack = (): void => {
        this.lastAckTime = Date.now();
        const latency = this.lastAckTime - this.lastSentTime;

        this.misses = 0;
        if (this.timeout) clearTimeout(this.timeout);

        this.hooks?.onAck?.(latency); // передаём задержку наружу
    };

    /**
     * @description Останавливаем все heartbeat процессы
     * @returns void
     * @public
     */
    public stop = () => {
        if (this.interval) clearInterval(this.interval);
        if (this.timeout) clearTimeout(this.timeout);

        this.interval = undefined;
        this.timeout = undefined;
        this.misses = 0;
        this.lastSentTime = 0;
        this.lastAckTime = 0;
    };

    /**
     * @description Останавливаем все heartbeat процессы и удаляем все данные
     * @returns void
     * @public
     */
    public destroy = () => {
        this.stop();

        this.misses = null;
        this.lastAckTime = null;
        this.lastSentTime = null;
        this.misses = null;
        this.intervalMs = null;
        this.hooks = null;
    };
}

/**
 * @author SNIPPIK
 * @description Функции для прямого общения классов
 * @type HeartbeatHooks
 */
type HeartbeatHooks = {
    /** Метод вызывается при необходимости отправки heartbeat-пакета */
    readonly send?: (time: number, latency?: number) => void;

    /** Метод вызывается, если не получен HEARTBEAT_ACK вовремя */
    readonly onTimeout: () => void;

    /** Метод вызывается при получении HEARTBEAT_ACK */
    readonly onAck?: (latency: number) => void;
};