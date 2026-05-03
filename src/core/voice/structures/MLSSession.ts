import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { DAVESession, iType } from "#native";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Текущая максимальная версия протокола DAVE, поддерживаемая этой реализацией.
 *              Используется для согласования версий с сервером Discord.
 * @public
 */
let MAX_DAVE_PROTOCOL: number = 1;

/**
 * @author SNIPPIK
 * @description Количество секунд, в течение которых предыдущая транзакция (переход) считается действительной.
 *              Если за это время не произошёл финальный коммит, переход аннулируется.
 * @const TRANSITION_EXPIRY
 */
const TRANSITION_EXPIRY = 10;

/**
 * @author SNIPPIK
 * @description Дополнительное время (в секундах), дающееся на выполнение перехода при понижении версии протокола.
 *              Это позволяет плавно деградировать шифрование, не обрывая воспроизведение.
 * @const TRANSITION_EXPIRY_PENDING_DOWNGRADE
 */
const TRANSITION_EXPIRY_PENDING_DOWNGRADE = 24;

/**
 * @author SNIPPIK
 * @description Управляет сеансом группового протокола DAVE (MLS) для сквозного шифрования голосовых каналов Discord.
 *              Обеспечивает инициализацию, обновление ключей, обработку переходов между версиями протокола,
 *              а также шифрование/расшифрование аудиопакетов.
 * @extends TypedEmitter<ClientMLSEvents>
 * @public
 */
export class MLSSession extends TypedEmitter<ClientMLSEvents> {
    /** Идентификатор последнего успешно выполненного перехода (transition). */
    public lastTransition_id?: number;

    /** Карта ожидающих переходов: ключ – идентификатор перехода, значение – версия протокола. */
    private pendingTransitions = new Map<number, number>();

    /** Флаг, указывающий, что данный сеанс был понижен до версии 0 (passthrough-режим). */
    private downgraded = false;

    /** Флаг повторной инициализации сеанса (например, после невалидного перехода). */
    public reinitializing = false;

    /** Экземпляр низкоуровневой DAVE-сессии (реализация на Rust через N-API). */
    public session: iType<typeof DAVESession>;

    /** Флаг, сигнализирующий, что в данный момент происходит переход (переключение версии). */
    private _isTransitioning = false;

    /**
     * @description Максимальная версия протокола, поддерживаемая этой реализацией.
     * @returns number – текущее значение MAX_DAVE_PROTOCOL.
     */
    public static get max_version(): number {
        return MAX_DAVE_PROTOCOL;
    };

    /**
     * @description Указывает, выполняется ли в данный момент переход между версиями протокола.
     * @returns true, если переход активен (шифрование заблокировано), иначе false.
     */
    public get isTransitioning(): boolean {
        return this._isTransitioning;
    };

    /**
     * @description Возвращает внутренний статус DAVE-сессии (число, определённое реализацией Rust).
     * @returns число – статус (0 = инициализация, 1 = готов, 2 = ошибка и т.п.).
     */
    public get status() {
        return this?.session?.status;
    };

    /**
     * @description Устанавливает внешнего отправителя (external sender) для сессии.
     *              Внешний отправитель необходим для обработки коммитов от сервера.
     * @param externalSender – буфер с данными внешнего отправителя.
     * @throws {Error} если сессия не инициализирована.
     */
    public set externalSender(externalSender: Buffer) {
        if (!this.session) throw new Error("No session available");
        this.session.setExternalSender(externalSender);
        this.emit("debug", "Set MLS external sender");
    };

    /**
     * @description Подготавливает сессию к новой эпохе (epoch).
     *              Вызывается Discord при смене ключей или версии протокола.
     * @param data – данные эпохи (включая номер эпохи и версию протокола).
     */
    public set prepareEpoch(data: VoiceDavePrepareEpochData) {
        if (this.reinitializing) return;

        // При первой эпохе (epoch === 1) инициализируем сессию с указанной версией
        if (data.epoch === 1) {
            this.version = data.protocol_version;
            this.reinit();
        }
    };

    /**
     * @description Восстанавливает сессию после недействительного перехода.
     *              Вызывается, когда коммит или welcome не прошли проверку.
     * @param transitionId – идентификатор перехода, который признан недействительным.
     */
    public set recoverFromInvalidTransition(transitionId: number) {
        if (this.reinitializing) return;
        this.reinitializing = true;
        this.emit("invalidateTransition", transitionId);
        this.reinit();
    };

    /**
     * @description Создаёт экземпляр MLSSession.
     * @param version – используемая версия протокола DAVE.
     * @param user_id – идентификатор пользователя (snowflake).
     * @param channel_id – идентификатор голосового канала.
     */
    public constructor(
        private version: number,
        public user_id: string,
        public channel_id: string
    ) {
        super();
    };

    /**
     * @description (Пере)инициализирует базовую DAVE-сессию.
     *              Если сессия уже существует, вызывает `reinit`, иначе создаёт новую.
     *              После инициализации генерируется событие `key` с сериализованным KeyPackage.
     */
    public reinit = (): void => {
        if (this.version > 0) {
            if (this.session) {
                this.session.reinit(this.version, this.user_id, this.channel_id);
            } else {
                this.session = new DAVESession(this.version, this.user_id, this.channel_id);
            }
            // Отправляем KeyPackage для распространения среди других участников
            this.emit("key", this.session.getSerializedKeyPackage());
        } else if (this.session) {
            // Версия 0 – переводим сессию в passthrough-режим (без шифрования)
            this.session.reset();
            this.session.setPassthroughMode(true, TRANSITION_EXPIRY);
        }
    };

    /**
     * @description Подготавливает переход на новую версию протокола.
     *              Сохраняет информацию о pending-переходе.
     * @param data – данные перехода (transition_id, protocol_version).
     * @returns true, если переход требует выполнения (id !== 0), иначе false.
     */
    public prepareTransition = (data: VoiceDavePrepareTransitionData) => {
        this.pendingTransitions.set(data.transition_id, data.protocol_version);

        // Автоматически удаляем ожидающий переход через 5 секунд, если он не был выполнен
        setTimeout(() => {
            if (this.pendingTransitions?.has(data.transition_id)) {
                this.pendingTransitions.delete(data.transition_id);
            }
        }, 5_000);

        // Переход с id=0 выполняется немедленно
        if (data.transition_id === 0) this.executeTransition(data.transition_id);
        else if (data.protocol_version === 0) {
            // При понижении до версии 0 включаем passthrough с увеличенным тайм-аутом
            this.session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE);
        }
        return data.transition_id !== 0;
    };

    /**
     * @description Выполняет переход на версию протокола, связанную с указанным идентификатором.
     * @param transition_id – идентификатор перехода.
     * @returns true, если переход выполнен успешно, иначе false.
     */
    public executeTransition = (transition_id: number) => {
        this._isTransitioning = true; // Блокируем шифрование на время перехода

        if (!this.pendingTransitions.has(transition_id)) {
            return false;
        }

        const oldVersion = this.version;
        this.version = this.pendingTransitions.get(transition_id)!;

        // Обработка понижения и повышения версии
        if (oldVersion !== this.version && this.version === 0) {
            this.downgraded = true;
        } else if (transition_id > 0 && this.downgraded) {
            this.downgraded = false;
            // При возврате к нормальной версии временно включаем passthrough на короткое время
            this.session?.setPassthroughMode(true, TRANSITION_EXPIRY);
        }

        this.lastTransition_id = transition_id;
        this.pendingTransitions.delete(transition_id);
        this._isTransitioning = false;
        return true;
    };

    /**
     * @description Обрабатывает предложения (proposals) от группы MLS.
     * @param payload – бинарные данные proposals (первый байт – тип операции, остальное – сами данные).
     * @param connectedClients – массив идентификаторов клиентов, подключённых в данный момент.
     * @returns Буфер, содержащий commit и (опционально) welcome, либо null, если commit отсутствует.
     */
    public processProposals = (payload: Buffer, connectedClients: Array<string>): Buffer | null => {
        if (!this.session) throw new Error("No session available");
        const { commit, welcome } = this.session.processProposals(
            payload.readUInt8(0) as 0 | 1,
            payload.subarray(1),
            connectedClients
        );
        if (!commit) return null;
        // Если welcome присутствует, конкатенируем его с commit для удобства передачи
        return welcome ? Buffer.concat([commit, welcome]) : commit;
    };

    /**
     * @description Обрабатывает коммит от группы MLS.
     * @param payload – бинарные данные коммита (первые 2 байта – transition_id, остальное – данные).
     * @returns Результат перехода (успех/неудача и идентификатор).
     */
    public processCommit = (payload: Buffer): TransitionResult => {
        if (!this.session) throw new Error('No session available');
        const transition_id = payload.readUInt16BE(0);
        try {
            this.session.processCommit(payload.subarray(2));
            if (transition_id === 0) {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            } else {
                // Для переходов с ненулевым id сохраняем текущую версию как ожидаемую
                this.pendingTransitions.set(transition_id, this.version);
            }
            this.emit('debug', `MLS commit processed (transition id: ${transition_id})`);
            return { transition_id, success: true };
        } catch (error) {
            this.emit('debug', `MLS commit errored from transition ${transition_id}: ${error}`);
            this.recoverFromInvalidTransition = transition_id;
            return { transition_id, success: false };
        }
    }

    /**
     * @description Обрабатывает welcome-сообщение от группы MLS (при добавлении нового участника).
     * @param payload - бинарные данные welcome (первые 2 байта – transition_id, остальное – данные).
     * @returns Результат перехода (успех/неудача и идентификатор).
     */
    public processWelcome = (payload: Buffer): TransitionResult => {
        if (!this.session) throw new Error('No session available');
        const transition_id = payload.readUInt16BE(0);
        try {
            this.session.processWelcome(payload.subarray(2));
            if (transition_id === 0) {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            } else {
                this.pendingTransitions.set(transition_id, this.version);
            }
            this.emit('debug', `MLS welcome processed (transition id: ${transition_id})`);
            return { transition_id, success: true };
        } catch (error) {
            this.emit('debug', `MLS welcome errored from transition ${transition_id}: ${error}`);
            this.recoverFromInvalidTransition = transition_id;
            return { transition_id, success: false };
        }
    }

    /**
     * @description Шифрует массив Opus-пакетов с использованием текущего состояния сессии.
     * @param packets массив исходных (не зашифрованных) пакетов.
     * @returns Массив зашифрованных пакетов (или null, если шифрование невозможно).
     */
    public encrypt = (packets: Buffer[]) => {
        // Шифрование возможно только при версии > 0, сессия готова и нет активного перехода
        if (this.version === 0 || !this.session?.ready || this._isTransitioning) return null;
        return this.session.encryptOpusBatch(packets);
    };

    /**
     * @description Полностью уничтожает сессию, освобождая ресурсы.
     *              Останавливает шифрование, очищает ожидающие переходы и сбрасывает ссылки.
     */
    public destroy = () => {
        super.destroy();
        this._isTransitioning = true; // Сразу блокируем шифрование

        if (this.session) {
            try {
                this.session.reset();
            } catch (e) { /* игнорируем ошибки при уничтожении */ }
        }

        this.session = null;
        this.reinitializing = false;
        this.user_id = null;
        this.channel_id = null;
        this.lastTransition_id = null;
        this.pendingTransitions.clear();
        this.pendingTransitions = null;
        this.downgraded = false;
    };
}

/**
 * @author SNIPPIK
 * @description События, которые может генерировать MLSSession.
 * @interface ClientMLSEvents
 */
export interface ClientMLSEvents {
    /** Возникает при критической ошибке (например, невалидный коммит). */
    "error": (error: Error) => void;

    /** Отладочные сообщения (полезно для логирования переходов, инициализации). */
    "debug": (message: string) => void;

    /** Генерируется, когда доступен новый KeyPackage (отправляется серверу или другим участникам). */
    "key": (message: Buffer) => void;

    /** Вызывается, когда переход признан недействительным и требуется повторная инициализация. */
    "invalidateTransition": (transitionId: number) => void;
}

/**
 * @author SNIPPIK
 * @description Результат обработки коммита или welcome-сообщения.
 * @interface TransitionResult
 * @private
 */
interface TransitionResult {
    success: boolean;
    transition_id: number;
}