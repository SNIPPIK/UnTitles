import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { DAVESession, iType } from "#native";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Текущая версия протокола dave
 */
let MAX_DAVE_PROTOCOL: number = 1;

/**
 * @author SNIPPIK
 * @description Количество секунд, в течение которых предыдущая транзакция должна быть действительна
 * @const TRANSITION_EXPIRY
 */
const TRANSITION_EXPIRY = 10;

/**
 * @author SNIPPIK
 * @description Произвольное количество секунд, позволяющее выполнить транзитную передачу для понижения рейтинга в середине.
 * @const TRANSITION_EXPIRY_PENDING_DOWNGRADE
 */
const TRANSITION_EXPIRY_PENDING_DOWNGRADE = 24;

/**
 * @author SNIPPIK
 * @description Управляет сеансом группы протокола DAVE.
 * @class MLSSession
 * @extends TypedEmitter
 * @public
 */
export class MLSSession extends TypedEmitter<ClientMLSEvents> {
    /** Последний выполненный идентификатор перехода */
    public lastTransition_id?: number;

    /** Ожидаемый переход */
    private pendingTransitions = new Map<number, number>();

    /** Был ли данный сеанс ранее понижен в рейтинге */
    private downgraded = false;

    /** Выполняется ли повторная инициализация сеанса из-за недопустимого перехода */
    public reinitializing = false;

    /** Базовый сеанс DAVE этой оболочки */
    public session: iType<typeof DAVESession>;

    /** Выполняется ли переход кода шифрования */
    private _isTransitioning = false;

    /**
     * @description Выполнен ли переход от старого кода к новому
     * @public
     */
    public get isTransitioning(): boolean {
        return this._isTransitioning;
    };

    /**
     * @description Максимальная доступная версия протокола
     * @returns number
     */
    public static get max_version(): number {
        return MAX_DAVE_PROTOCOL;
    };

    /**
     * @description Установите внешнего отправителя для этого сеанса.
     * @param externalSender - Внешний отправитель
     * @public
     */
    public set externalSender(externalSender: Buffer) {
        // Если нет запущенной сессии
        if (!this.session) throw new Error("No session available");
        this.session.setExternalSender(externalSender);
        this.emit("debug", "Set MLS external sender");
    };

    /**
     * Приготовьтесь к новой epoch
     * @param data - Данные epoch
     * @public
     */
    public set prepareEpoch(data: VoiceDavePrepareEpochData) {
        if (this.reinitializing) return;

        this.emit("debug", `Preparing for epoch (${data.epoch})`);

        // Если есть идентификатор
        if (data.epoch === 1) {
            this.version = data.protocol_version;
            this.reinit();
        }
    };

    /**
     * @description Восстановление после недопустимого перехода путем повторной инициализации.
     * @param transitionId - Идентификатор перехода для аннулирования
     * @returns void
     * @public
     */
    public set recoverFromInvalidTransition(transitionId: number) {
        if (this.reinitializing) return;
        this.emit("debug", `Invalidating transition ${transitionId}`);
        this.reinitializing = true;
        this.emit("invalidateTransition", transitionId);
        this.reinit();
    };

    /**
     * @description Создаем класс для управления сеансом DAVE
     * @constructor
     * @public
     */
    public constructor(
        /** Используемая версия протокола DAVE */
        private version: number,

        /** Идентификатор пользователя, представленный этим сеансом. */
        public user_id: string,

        /** Канал в котором будет произведено сквозное шифрование */
        public channel_id: string
    ) {
        super();
    };

    /**
     * @description Повторно инициализирует базовый сеанс
     * @returns void
     * @public
     */
    public reinit = (): void => {
        // Если можно создать сессию
        if (this.version > 0 && this.user_id && this.channel_id) {
            // Если сессия уже есть
            if (this.session) {
                this.session.reinit(this.version, this.user_id, this.channel_id);
                this.emit("debug", `Session reinitialized for protocol version ${this.version}`);
            }

            // Если сессии еще нет
            else {
                this.session = new DAVESession(this.version, this.user_id, this.channel_id);
                this.emit("debug", `Session initialized for protocol version ${this.version}`);
            }

            // Отправляем ключ
            this.emit("key", this.session.getSerializedKeyPackage());
        }

        // Если уже есть сессия
        else if (this.session) {
            this.session.reset();
            this.session.setPassthroughMode(true, TRANSITION_EXPIRY);
            this.emit("debug", "Session reset");
        }
    };

    /**
     * @description Подготовьтесь к переходу.
     * @param data - Данные о переходе
     * @returns boolean
     * @public
     */
    public prepareTransition = (data: VoiceDavePrepareTransitionData) => {
        this.emit("debug", `Preparing for transition (${data.transition_id}, v${data.protocol_version})`);
        this.pendingTransitions.set(data.transition_id, data.protocol_version);

        // Удаляем старые переходы через 5 секунд, если они не выполнились
        setTimeout(() => {
            if (this.pendingTransitions?.has(data.transition_id)) {
                this.pendingTransitions.delete(data.transition_id);
            }
        }, 5e3);

        if (data.transition_id === 0) this.executeTransition(data.transition_id);
        else if (data.protocol_version === 0) this.session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE);
        return data.transition_id !== 0;
    };

    /**
     * @description Выполнить переход.
     * @param transition_id - Идентификатор перехода для выполнения
     * @returns boolean
     * @public
     */
    public executeTransition = (transition_id: number) => {
        this._isTransitioning = true; // Блокируем отправку
        this.emit("debug", `Executing transition (${transition_id})`);

        // Если нет данных для смены версии DAVE
        if (!this.pendingTransitions.has(transition_id)) {
            this.emit("debug", `Received execute transition, but we don't have a pending transition for ${transition_id}`);
            return false;
        }

        const oldVersion = this.version;
        this.version = this.pendingTransitions.get(transition_id)!;

        // Управление обновлениями и понижение версии
        if (oldVersion !== this.version && this.version === 0) {
            this.downgraded = true;
            this.emit("debug", "Session downgraded");
        } else if (transition_id > 0 && this.downgraded) {
            this.downgraded = false;
            this.session?.setPassthroughMode(true, TRANSITION_EXPIRY);
            this.emit("debug", "Session upgraded");
        }

        // В будущем можно будет подать сигнал DAVESession о переходе, но на данный момент поддерживается только версия v1.
        this.lastTransition_id = transition_id;
        this.emit("debug", `Transition executed (v${oldVersion} -> v${this.version}, id: ${transition_id})`);
        this.pendingTransitions.delete(transition_id);
        this._isTransitioning = false;
        return true;
    };

    /**
     * @description Обрабатывает предложения от группы MLS.
     * @param payload - Полезная нагрузка двоичного сообщения
     * @param connectedClients - Набор подключенных идентификаторов клиентов
     * @returns Buffer
     * @public
     */
    public processProposals = (payload: Buffer, connectedClients: Array<string>): Buffer | null => {
        if (!this.session) throw new Error("No session available");
        this.emit("debug", "MLS proposals processed");
        const { commit, welcome } = this.session.processProposals(
            payload.readUInt8(0) as 0 | 1,
            payload.subarray(1),
            connectedClients
        );

        if (!commit) return null;
        return welcome ? Buffer.concat([commit, welcome]) : commit;
    };

    /**
     * @description Обрабатывает фиксацию из группы MLS.
     * @param type - Тип вызова
     * @param payload - Полезная нагрузка
     * @returns TransitionResult
     * @public
     */
    public processMLSTransit = (type: "commit" | "welcome", payload: Buffer): TransitionResult => {
        if (!this.session) throw new Error("No session available");
        const transition_id = payload.readUInt16BE(0);
        const flag = payload.subarray(2);

        try {
            this.session[type === "commit" ? "processCommit" : "processWelcome"](flag);

            if (transition_id === 0) {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            } else this.pendingTransitions.set(transition_id, this.version);

            this.emit("debug", `MLS ${type} processed (transition id: ${transition_id})`);
            return { transition_id, success: true };
        } catch (error) {
            this.emit("debug", `MLS ${type} errored from transition ${transition_id}: ${error}`);
            this.recoverFromInvalidTransition = transition_id;
            return { transition_id, success: false };
        }
    };

    /**
     * @description Зашифруйте пакет, используя сквозное шифрование.
     * @param packets - Пакет для шифрования
     * @returns Buffer[]
     * @public
     */
    public encrypt = (packets: Buffer[]) => {
        if (this.version === 0 || !this.session?.ready || this._isTransitioning) return null;
        return this.session.encryptOpusBatch(packets);
    };

    /**
     * @description Сбрасывает сеанс и удаляет его
     * @returns void
     * @public
     */
    public destroy = () => {
        super.destroy();
        this._isTransitioning = true; // Сразу блокируем шифрование

        if (this.session) {
            try {
                this.session.reset();
                // Если библиотека поддерживает явное удаление объекта из кучи C++:
                // (this.session as any).delete?.();
            } catch (e) {}
        }

        this.session = null;
        this.reinitializing = null;
        this.user_id = null;
        this.channel_id = null;
        this.lastTransition_id = null;
        this.pendingTransitions.clear();
        this.pendingTransitions = null;
        this.downgraded = null;

        this.emit("debug", "MLS Session destroyed");
    };
}

/**
 * @author SNIPPIK
 * @description События класса DAVESession
 * @interface MLSSession
 */
export interface ClientMLSEvents {
    // Ошибка?! Какая ошибка
    "error": (error: Error) => void;

    // Для отладки
    "debug": (message: string) => void;

    // Получение ключа
    "key": (message: Buffer) => void;

    // Если ключ больше не действителен
    "invalidateTransition": (transitionId: number) => void;
}

/**
 * @author SNIPPIK
 * @description Результат перехода
 * @interface TransitionResult
 * @private
 */
interface TransitionResult {
    success: boolean;
    transition_id: number;
}