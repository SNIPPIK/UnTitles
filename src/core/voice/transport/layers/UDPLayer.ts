import { VoiceUDPSocket, WebSocketOpcodes } from "#core/voice";
import { BaseLayer} from "#core/voice/transport/layers/BaseLayer";

/**
 * @author SNIPPIK
 * @description Максимальное количество повторных попыток
 * @const MAX_RETRIES
 * @private
 */
const MAX_RETRIES = 5;

export class UDPLayer extends BaseLayer<void> {
    /**
     * @description Клиент UDP соединения, ключевой класс для отправки пакетов
     * @public
     */
    public _udp: VoiceUDPSocket;

    /**
     * @description Готовность UDP слоя
     * @public
     */
    public get ready() {
        return this._udp.status === "connected";
    };

    /**
     * @description Текущий статус UDP слоя
     * @public
     */
    public get status() {
        return this._udp.status;
    };

    /**
     * @description Текущий статус UDP слоя
     * @public
     */
    public get lost() {
        if (!this._udp) return 0;
        return this._udp.drops;
    };

    /**
     * @description Кол-во пакетов в UDP слое
     * @public
     */
    public get packets() {
        if (!this._udp) return 0;
        return this._udp.packets;
    };

    /**
     * @description Отправление пакетов в UDP слой -> Rust -> Scheduler
     * @param frames
     * @public
     */
    public packet = (frames: Buffer[]) => {
        if (!this._udp) return;
        return this._udp.packet(frames);
    };

    /**
     * @description Создание ключевого обьекта
     * @param d - Пакет Ready полученный от WS
     * @public
     */
    public create = (d: WebSocketOpcodes.ready["d"]): Promise<Error | {ip: string, port: number}> => {
        // Если UDP был поднят ранее
        if (this._udp) {
            this._udp.destroy();
            this._udp = null;
        }

        // Создаем UDP подключение
        const udp = this._udp = new VoiceUDPSocket();

        // Создаем обещание
        return new Promise((resolve) => {
            udp.connect(d); // Подключаемся

            const discoveryPacket = udp.discovery(d.ssrc);
            let attempts = 0;

            const sendDiscovery = () => {
                attempts++;
                udp.packet(discoveryPacket);

                // Планируем следующую попытку, если не превышен лимит
                if (attempts < MAX_RETRIES) {
                    retryTimer = setTimeout(sendDiscovery, 75);
                }
            };

            // Отправляем первый пакет и запускаем retry-цикл
            let retryTimer: NodeJS.Timeout;
            sendDiscovery();

            // Таймер отключения, если не удастся получить ответ discovery
            const timeout = setTimeout(() => {
                if (retryTimer) clearTimeout(retryTimer);
                return resolve(new Error("[Transport/UDP]: Timeout to send Discovery handshake"));
            }, 2e3);

            /**
             * @description Ожидаем ответ с данными для прямого подключения через NAT
             * @event discovery
             * @private
             */
            udp.once("discovery", (data) => {
                clearTimeout(timeout);
                clearTimeout(retryTimer); // отменяем повторные отправки
                resolve(data); // предполагаем, что здесь нужен resolve
            });
        });
    };

    /**
     * @description Метод удаления UDP слоя
     * @public
     */
    public destroy = () => {
        this._udp.destroy();
        this._udp = null;
    };
}