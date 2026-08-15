import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { DAVESession, iType } from "#native";
import { TypedEmitter } from "#structures";

/**
 * @author SNIPPIK
 * @description Текущая максимальная версия протокола DAVE, поддерживаемая этой реализацией.
 *              Используется для согласования версий с сервером Discord.
 * @version 1.3
 * @public
 */
const MAX_DAVE_PROTOCOL: number = 1;

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
 * Управляет сеансом группового протокола DAVE (MLS) для сквозного шифрования (E2EE)
 * голосовых каналов Discord.
 *
 * Обеспечивает:
 * - Инициализацию и пере инициализацию сессии при смене версии протокола.
 * - Обработку предложений (Proposals), коммитов (Commit) и приглашений (Welcome).
 * - Управление переходами между версиями протокола с таймаутами.
 * - Шифрование и шифрование аудио пакетов (Opus) с использованием DAVE.
 * - Корректную обработку ошибок с возможностью восстановления.
 *
 * @extends TypedEmitter<ClientMLSEvents>
 *
 * @example
 * ```ts
 * const session = new MLSSession(1, "user123", "channel456");
 * session.on("key", (keyPackage) => { ... });
 * session.reinit();
 * ```
 */
export class MLSSession extends TypedEmitter<ClientMLSEvents> {
    /**
     * Идентификатор последнего успешно выполненного перехода.
     * `undefined`, если переходов ещё не было.
     */
    public lastTransition_id?: number;

    /**
     * Ожидающие переходы: ключ — `transition_id`, значение — целевая версия протокола.
     * Переход считается завершённым только после вызова `executeTransition`.
     */
    private pendingTransitions = new Map<number, number>();

    /**
     * Таймеры для ожидающих переходов.
     * Если переход не завершён в течение 5 секунд, он автоматически удаляется.
     */
    private transitionTimers = new Map<number, NodeJS.Timeout>();

    private _pendingExternalSender: Buffer | null = null;

    /**
     * Флаг, указывающий, что протокол был понижен с ненулевой версии до версии 0.
     * Используется для корректного восстановления при последующем повышении.
     */
    private downgraded = false;

    /**
     * Флаг, указывающий, что сессия находится в процессе инициализации
     * (после ошибки перехода). Пока `true`, входящие `prepareEpoch` игнорируются.
     */
    public reinitializing = false;

    /**
     * Экземпляр нижележащей DAVE-сессии.
     * Может быть `null` после вызова `destroy()`.
     */
    public session: iType<typeof DAVESession>;

    /**
     * Флаг, указывающий, что в данный момент выполняется переход между версиями.
     * Блокирует повторные вызовы `executeTransition` и шифрование.
     */
    private _isTransitioning = false;

    /**
     * Максимальная поддерживаемая версия протокола DAVE.
     */
    public static get max_version(): number {
        return MAX_DAVE_PROTOCOL;
    };

    /**
     * Возвращает `true`, если в данный момент выполняется переход.
     */
    public get isTransitioning(): boolean {
        return this._isTransitioning;
    };

    /**
     * Возвращает текущий статус сессии (зависит от реализации `DAVESession`).
     */
    public get status() {
        return this.session?.status;
    };

    /**
     * Устанавливает внешнего отправителя для сессии.
     * Используется при работе с делегированным шифрованием.
     *
     * @throws {Error} Если сессия не инициализирована.
     */
    public set externalSender(externalSender: Buffer) {
        if (this.session) {
            this.session.setExternalSender(externalSender);
        } else {
            // Сохраняем до создания сессии
            this._pendingExternalSender = externalSender;
        }
    }

    /**
     * Обрабатывает данные подготовки эпохи от Discord.
     *
     * Если `epoch === 1`, обновляет версию протокола и запускает инициализацию.
     * Повторные вызовы с `epoch !== 1` или во время `reinitializing` игнорируются.
     *
     * @throws {Error} Косвенно, через `reinit()`.
     */
    public set prepareEpoch(data: VoiceDavePrepareEpochData) {
        if (this.reinitializing) return;

        // Только первая эпоха вызывает инициализацию.
        if (data.epoch !== 1) return;

        this.version = data.protocol_version;
        this.reinit();
    };

    /**
     * Обрабатывает сигнал о невалидном переходе от Discord.
     *
     * Устанавливает флаг `reinitializing`, вызов событие `invalidateTransition`,
     * очищает все ожидающие переходы и запускает инициализацию.
     *
     * @param id - Идентификатор невалидного перехода.
     */
    public set recoverFromInvalidTransition(id: number) {
        if (this.reinitializing) return;

        this.reinitializing = true;
        this.emit("invalidateTransition", id);

        this.clearTransitions();
        this.reinit();
    };

    /**
     * @param version    - Начальная версия протокола.
     * @param user_id    - Идентификатор текущего пользователя.
     * @param channel_id - Идентификатор голосового канала.
     */
    constructor(
        private version: number,
        public user_id: string,
        public channel_id: string
    ) {
        super();
    };

    /**
     * Обрабатывает предложения (Proposals) от других участников.
     *
     * @param payload          - Буфер, содержащий тип предложения (1 байт) и данные.
     * @param connectedClients - Список подключённых клиентов (участников).
     *
     * @returns Буфер с коммитом (и опционально приглашением), если требуется;
     *          `null`, если коммит не требуется.
     *
     * @throws {Error} Если сессия не инициализирована.
     */
    public processProposals = (
        payload: Buffer,
        connectedClients: readonly string[]
    ): Buffer | null => {
        if (!this.session) return null;   // не бросаем ошибку

        const type = payload.readUInt8(0);
        const data = payload.subarray(1);

        const result = this.session.processProposals(
            type as 0 | 1,
            data,
            connectedClients
        );

        if (!result.commit) return null;

        return result.welcome
            ? Buffer.concat([result.commit, result.welcome])
            : result.commit;
    };

    /**
     * Обрабатывает коммит (Commit) от другого участника.
     *
     * @param payload - Буфер, содержащий `transition_id` (2 байта) и данные коммита.
     *
     * @returns Объект с `transition_id` и флагом `success`.
     *          При ошибке вызывает `recoverFromInvalidTransition`.
     */
    public processCommit = (payload: Buffer) => {
        const transition_id = payload.readUInt16BE(0);

        if (!this.session) {
            return { transition_id, success: false };
        }

        try {
            this.session.processCommit(payload.subarray(2));

            if (transition_id !== 0) {
                this.pendingTransitions.set(transition_id, this.version);
            } else {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            }

            return { transition_id, success: true };
        } catch (e) {
            this.recoverFromInvalidTransition = transition_id;
            return { transition_id, success: false };
        }
    };

    /**
     * Обрабатывает приглашение (Welcome) для присоединения к группе.
     *
     * @param payload - Буфер, содержащий `transition_id` (2 байта) и данные приглашения.
     *
     * @returns Объект с `transition_id` и флагом `success`.
     *          При ошибке вызывает `recoverFromInvalidTransition`.
     */
    public processWelcome = (payload: Buffer) => {
        const transition_id = payload.readUInt16BE(0);

        if (!this.session) {
            return { transition_id, success: false };
        }

        try {
            this.session.processWelcome(payload.subarray(2));

            if (transition_id !== 0) {
                this.pendingTransitions.set(transition_id, this.version);
            } else {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            }

            return { transition_id, success: true };
        } catch (e) {
            this.recoverFromInvalidTransition = transition_id;
            return { transition_id, success: false };
        }
    };

    /**
     * (Пере)инициализирует сессию с текущей версией протокола.
     *
     * - Если версия > 0: создаёт или инициализирует `DAVESession`.
     * - Если версия === 0: сбрасывает сессию и включает режим passthrough.
     *
     * Автоматически вызывается при изменении `prepareEpoch`.
     */
    public reinit = (): void => {
        if (this.version > 0) {
            if (this.session) {
                this.session.reinit(this.version, this.user_id, this.channel_id);
            } else {
                this.session = new DAVESession(this.version, this.user_id, this.channel_id);
            }

            // Применяем отложенный externalSender, если он был получен ранее
            if (this._pendingExternalSender) {
                this.session.setExternalSender(this._pendingExternalSender);
                this._pendingExternalSender = null;
            }

            this.emit("key", this.session.getSerializedKeyPackage());
        } else if (this.session) {
            this.session.reset();
            this.session.setPassthroughMode(true, TRANSITION_EXPIRY);
        }
    };

    /**
     * Подготавливает переход на новую версию протокола.
     *
     * - Регистрирует ожидающий переход с таймаутом в 5 секунд.
     * - Для `transition_id === 0` немедленно выполняет переход.
     * - Для `protocol_version === 0` включает режим passthrough.
     *
     * @param data - Данные перехода (`transition_id`, `protocol_version`).
     *
     * @returns `true`, если переход требует последующего вызова `executeTransition`;
     *          `false` для `transition_id === 0` (немедленное выполнение).
     */
    public prepareTransition = (data: VoiceDavePrepareTransitionData): boolean => {
        const { transition_id, protocol_version } = data;

        this.pendingTransitions.set(transition_id, protocol_version);

        // Сбрасываем предыдущий таймер, если переход с таким ID уже ожидался.
        if (this.transitionTimers.has(transition_id)) {
            clearTimeout(this.transitionTimers.get(transition_id)!);
        }

        // Устанавливаем таймер автоочистки ожидающего перехода (5 секунд).
        const timer = setTimeout(() => {
            if (this.pendingTransitions.has(transition_id)) {
                this.pendingTransitions.delete(transition_id);
            }
            this.transitionTimers.delete(transition_id);
        }, 5000);

        this.transitionTimers.set(transition_id, timer);

        // transition_id === 0 означает немедленный переход.
        if (transition_id === 0) {
            this.executeTransition(0);
        }

        // Включение passthrough при переходе на нулевую версию.
        if (protocol_version === 0) {
            this.session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE);
        }

        return transition_id !== 0;
    };

    /**
     * Выполняет отложенный переход на новую версию протокола.
     *
     * - Защищён от повторного входа (reentry) флагом `_isTransitioning`.
     * - Обновляет `version`, обрабатывает даунгрейд и восстановление.
     * - Очищает таймер и удаляет переход из `pendingTransitions`.
     *
     * @param transition_id - Идентификатор перехода для выполнения.
     *
     * @returns `true`, если переход выполнен успешно;
     *          `false`, если переход не найден или уже выполняется.
     */
    public executeTransition = (transition_id: number): boolean => {
        if (this._isTransitioning) return false;

        const version = this.pendingTransitions.get(transition_id);
        if (version === undefined) return false;

        this._isTransitioning = true;

        const oldVersion = this.version;
        this.version = version;

        // Фиксируем даунгрейд.
        if (oldVersion !== 0 && this.version === 0) {
            this.downgraded = true;
        }

        // При восстановлении после даунгрейда включаем passthrough.
        if (this.downgraded && this.version > 0) {
            this.session?.setPassthroughMode(true, TRANSITION_EXPIRY);
            this.downgraded = false;
        }

        this.lastTransition_id = transition_id;

        // Очищаем состояние перехода.
        this.pendingTransitions.delete(transition_id);

        if (this.transitionTimers.has(transition_id)) {
            clearTimeout(this.transitionTimers.get(transition_id)!);
            this.transitionTimers.delete(transition_id);
        }

        this._isTransitioning = false;
        return true;
    };

    /**
     * Шифрует массив Opus-пакетов.
     *
     * Шифрование **не** выполняется, если:
     * - Версия протокола === 0 (passthrough).
     * - Сессия не готова (`session.ready === false`).
     * - Выполняется переход (`_isTransitioning === true`).
     * - Сессия инициализируется (`reinitializing === true`).
     *
     * @param packets - Массив буферов с Opus-данными.
     *
     * @returns Массив зашифрованных пакетов или `null`, если шифрование невозможно.
     */
    public encrypt = (packets: Buffer[]) => {
        if (
            this.version === 0 ||
            !this.session?.ready ||
            this._isTransitioning ||
            this.reinitializing
        ) return null;

        return this.session.encryptOpusBatch(packets);
    };

    /**
     * Очищает все ожидающие переходы и их таймеры.
     * Вызывается при инициализации после ошибки.
     */
    private clearTransitions() {
        this.pendingTransitions.clear();

        for (const t of this.transitionTimers.values()) {
            clearTimeout(t);
        }

        this.transitionTimers.clear();
    };

    /**
     * Уничтожает сессию и освобождает все ресурсы.
     *
     * - Сбрасывает нижележащую DAVE-сессию.
     * - Вызывает `super.destroy()` для очистки слушателей `TypedEmitter`.
     * - Обнуляет все поля объекта для помощи сборщику мусора.
     */
    public destroy = () => {
        this._isTransitioning = true;

        try {
            this.session?.reset();
        } catch (e) {
            this.emit("error", Error(`[Critical destroy error]\n${e}`));
        }

        super.destroy();
        this.clearTransitions();

        this.session = null;
        this.reinitializing = false;
        this.user_id = null;
        this.channel_id = null;
        this.lastTransition_id = null;
        this.pendingTransitions = null;
        this.transitionTimers = null;
        this.downgraded = false;
        this._pendingExternalSender = null;
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