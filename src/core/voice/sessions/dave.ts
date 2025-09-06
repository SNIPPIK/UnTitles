import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { Logger, TypedEmitter } from "#structures";
import { SILENT_FRAME } from "#core/audio";

/**
 * @author SNIPPIK
 * @description Версия протокола dave
 * @public
 */
let DAVE_PROTOCOL_VERSION: number = 0;

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
 * @description Количество пакетов, для которых допускается сбой дешифрования, пока мы не сочтем переход неудачным и не выполним повторную инициализацию.
 * @const DEFAULT_DECRYPTION_FAILURE_TOLERANCE
 */
const DEFAULT_DECRYPTION_FAILURE_TOLERANCE = 36;

/**
 * @author SNIPPIK
 * @description Управляет сеансом группы протокола DAVE.
 * @class ClientDAVE
 * @extends TypedEmitter
 * @public
 */
export class ClientDAVE extends TypedEmitter<ClientDAVEEvents> {
    /** Последний выполненный идентификатор перехода */
    public lastTransition_id?: number;

    /** Ожидаемый переход */
    private pendingTransition?: VoiceDavePrepareTransitionData;

    /** Был ли данный сеанс ранее понижен в рейтинге */
    private downgraded = false;

    /** Количество последовательных сбоев, возникших при дешифровании */
    private consecutiveFailures = 0;

    /** Количество последовательных сбоев, необходимое для попытки восстановления */
    private readonly failureTolerance: number = DEFAULT_DECRYPTION_FAILURE_TOLERANCE;

    /** Выполняется ли повторная инициализация сеанса из-за недопустимого перехода */
    public reinitializing = false;

    /** Базовый сеанс DAVE этой оболочки */
    public session: SessionMethods;

    /**
     * @description Доступная версия DAVE
     * @returns number
     * @public
     * @static
     */
    public static get version(): number {
        return DAVE_PROTOCOL_VERSION;
    };

    /**
     * @description Установите внешнего отправителя для этого сеанса.
     * @param externalSender - Внешний отправитель
     * @public
     */
    public set externalSender(externalSender: Buffer) {
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
        this.emit("debug", `Preparing for epoch (${data.epoch})`);
        if (data.epoch === 1) {
            this.protocolVersion = data.protocol_version;
            this.reinit();
        }
    };

    /**
     * @description Создаем класс для управления сеансом DAVE
     * @constructor
     * @public
     */
    public constructor(
        /** Используемая версия протокола DAVE */
        private protocolVersion: number,

        /** Идентификатор пользователя, представленный этим сеансом. */
        private user_id: string,

        /** Канал в котором будет произведено сквозное шифрование */
        private channel_id: string
    ) {
        super();
    };

    /**
     * @description Повторно инициализирует базовый сеанс
     * @returns void
     * @public
     */
    public reinit = (): void => {
        if (this.protocolVersion > 0 && this.user_id && this.channel_id) {
            // Если сессия уже есть
            if (this.session) {
                this.session.reinit(this.protocolVersion, this.user_id, this.channel_id);
                this.emit("debug", `Session reinitialized for protocol version ${this.protocolVersion}`);
            }

            // Если сессии еще нет
            else {
                this.session = new loaded_lib.DAVESession(this.protocolVersion, this.user_id, this.channel_id);
                this.emit("debug", `Session initialized for protocol version ${this.protocolVersion}`);
            }

            // Даем немного времени для отправки ключа
            setImmediate(() => {
                this.emit("key", this.session.getSerializedKeyPackage());
            });
        } else if (this.session) {
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
        this.pendingTransition = data;

        // Если включенный идентификатор перехода равен 0, переход предназначен для (повторной) инициализации и может быть выполнен немедленно.
        if (data.transition_id === 0) this.executeTransition(data.transition_id);
        else {
            if (data.protocol_version === 0) this.session?.setPassthroughMode(true, TRANSITION_EXPIRY_PENDING_DOWNGRADE);
            return true;
        }

        return false;
    };

    /**
     * @description Выполнить переход.
     * @param transition_id - Идентификатор перехода для выполнения
     * @returns boolean
     * @public
     */
    public executeTransition = (transition_id: number) => {
        this.emit("debug", `Executing transition (${transition_id})`);
        if (!this.pendingTransition) {
            this.emit("debug", `Received execute transition, but we don't have a pending transition for ${transition_id}`);
            return null;
        }

        let transitioned = false;
        if (transition_id === this.pendingTransition.transition_id) {
            const oldVersion = this.protocolVersion;
            this.protocolVersion = this.pendingTransition.protocol_version;

            // Управляйте обновлениями и откладывайте понижения
            if (oldVersion !== this.protocolVersion && this.protocolVersion === 0) {
                this.downgraded = true;
                this.emit("debug", "Session downgraded");
            } else if (transition_id > 0 && this.downgraded) {
                this.downgraded = false;
                this.session?.setPassthroughMode(true, TRANSITION_EXPIRY);
                this.emit("debug", "Session upgraded");
            }

            // В будущем мы также хотели бы подать сигнал DAVESession о переходе, но на данный момент поддерживается только версия v1.
            transitioned = true;
            this.reinitializing = false;
            this.lastTransition_id = transition_id;
            this.emit("debug", `Transition executed (v${oldVersion} -> v${this.protocolVersion}, id: ${transition_id})`);
        } else {
            this.emit(
                "debug",
                `Received execute transition for an unexpected transition id (expected: ${this.pendingTransition.transition_id}, actual: ${transition_id})`,
            );
        }

        this.pendingTransition = undefined;
        return transitioned;
    };

    /**
     * @description Восстановление после недопустимого перехода путем повторной инициализации.
     * @param transitionId - Идентификатор перехода для аннулирования
     * @returns void
     * @public
     */
    public recoverFromInvalidTransition = (transitionId: number): void => {
        if (this.reinitializing) return;
        this.emit("debug", `Invalidating transition ${transitionId}`);
        this.reinitializing = true;
        this.consecutiveFailures = 0;
        this.emit("invalidateTransition", transitionId);
        this.reinit();
    };

    /**
     * @description Обрабатывает предложения от группы MLS.
     * @param payload - Полезная нагрузка двоичного сообщения
     * @param connectedClients - Набор подключенных идентификаторов клиентов
     * @returns Buffer
     * @public
     */
    public processProposals = (payload: Buffer, connectedClients: Set<string>): Buffer | undefined => {
        if (!this.session) throw new Error("No session available");

        this.emit("debug", "MLS proposals processed");

        const { commit, welcome } = this.session.processProposals(
            payload.readUInt8(0) as 0 | 1,
            payload.subarray(1),
            Array.from(connectedClients),
        );

        if (!commit) return null;
        return welcome ? Buffer.concat([commit, welcome]) : commit;
    };

    /**
     * @description Обрабатывает фиксацию из группы MLS.
     * @param payload - Полезная нагрузка
     * @returns TransitionResult
     * @public
     */
    public processCommit = (payload: Buffer): TransitionResult => {
        if (!this.session) throw new Error("No session available");
        const transition_id = payload.readUInt16BE(0);

        try {
            this.session.processCommit(payload.subarray(2));

            if (transition_id === 0) {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            } else this.pendingTransition = { transition_id, protocol_version: this.protocolVersion };

            this.emit("debug", `MLS commit processed (transition id: ${transition_id})`);
            return { transition_id, success: true };
        } catch (error) {
            this.emit("debug", `MLS commit errored from transition ${transition_id}: ${error}`);
            this.recoverFromInvalidTransition(transition_id);
            return { transition_id, success: false };
        }
    };

    /**
     * @description Обрабатывает приветствие от группы MLS.
     * @param payload - Полезная нагрузка
     * @returns TransitionResult
     * @public
     */
    public processWelcome = (payload: Buffer): TransitionResult => {
        if (!this.session) throw new Error("No session available");
        const transition_id = payload.readUInt16BE(0);

        try {
            this.session.processWelcome(payload.subarray(2));
            if (transition_id === 0) {
                this.reinitializing = false;
                this.lastTransition_id = transition_id;
            } else this.pendingTransition = { transition_id, protocol_version: this.protocolVersion };

            this.emit("debug", `MLS welcome processed (transition id: ${transition_id})`);
            return { transition_id, success: true };
        } catch (error) {
            this.emit("debug", `MLS welcome errored from transition ${transition_id}: ${error}`);
            this.recoverFromInvalidTransition(transition_id);
            return { transition_id, success: false };
        }
    };

    /**
     * @description Зашифруйте пакет, используя сквозное шифрование.
     * @param packet - Пакет для шифрования
     * @returns Buffer
     * @public
     */
    public encrypt = (packet: Buffer) => {
        if (this.protocolVersion === 0 || !this.session?.ready || packet.equals(SILENT_FRAME)) return packet;
        return this.session.encryptOpus(packet);
    };

    /**
     * @description Расшифровать пакет, используя сквозное шифрование.
     * @param packet - Пакет для расшифровки
     * @param userId - Идентификатор пользователя, отправившего пакет
     * @returns Buffer
     * @public
     */
    public decrypt = (packet: Buffer, userId: string) => {
        const canDecrypt = this.session?.ready && (this.protocolVersion !== 0 || this.session?.canPassthrough(userId));
        if (packet.equals(SILENT_FRAME) || !canDecrypt || !this.session) return packet;

        try {
            const buffer = this.session.decrypt(userId, loaded_lib.MediaType.AUDIO, packet);
            this.consecutiveFailures = 0;
            return buffer;
        } catch (error) {
            if (!this.reinitializing && !this.pendingTransition) {
                this.consecutiveFailures++;
                this.emit("debug", `Failed to decrypt a packet (${this.consecutiveFailures} consecutive fails)`);

                if (this.consecutiveFailures > this.failureTolerance) {
                    if (this.lastTransition_id) this.recoverFromInvalidTransition(this.lastTransition_id);
                    else throw error;
                }
            } else if (this.reinitializing) {
                this.emit("debug", 'Failed to decrypt a packet (reinitializing session)');
            } else if (this.pendingTransition) {
                this.emit(
                    "debug",
                    `Failed to decrypt a packet (pending transition ${this.pendingTransition.transition_id} to v${this.pendingTransition.protocol_version})`,
                );
            }
        }

        return null;
    };

    /**
     * @description Сбрасывает сеанс и удаляет его
     * @returns void
     * @public
     */
    public destroy = () => {
        super.destroy();

        try {
            this.session?.reset?.();
        } catch {}

        this.session = null;
        this.reinitializing = null;
        this.user_id = null;
        this.channel_id = null;
        this.lastTransition_id = null;
        this.pendingTransition = null;
        this.downgraded = null;
        this.pendingTransition = null;
    };
}

/**
 * @author SNIPPIK
 * @description События класса DAVESession
 * @interface ClientDAVE
 */
export interface ClientDAVEEvents {
    // Ошибка?! Какая ошибка
    "error": (error: Error) => void

    // Для отладки
    "debug": (message: string) => void

    // Получение ключа
    "key": (message: Buffer) => void;

    // Если ключ больше не действителен
    "invalidateTransition": (transitionId: number) => void;
}

/**
 * @author SNIPPIK
 * @description Все методы сессии
 * @interface SessionMethods
 */
interface SessionMethods {
    /**
     * @description Проверяет, может ли пользователь с указанным userId пропускать данные без дополнительного шифрования.
     * @param user_id - Идентификатор пользователя Discord.
     * @returns `true`, если пропуск разрешён, иначе `false`.
     */
    canPassthrough(user_id: string): boolean;

    /**
     * @description Расшифровывает входящий пакет голосовых данных для указанного пользователя и типа медиа.
     * @param user_id - Идентификатор пользователя Discord.
     * @param mediaType - Тип медиа: 0 для аудио, 1 для видео.
     * @param frame - Буфер с зашифрованными данными.
     * @returns Расшифрованный буфер данных.
     */
    decrypt(user_id: string, mediaType: 0 | 1, frame: Buffer): Buffer;

    /**
     * @description Шифрует пакет Opus аудио для отправки.
     * @param frame - Буфер с аудио данными Opus.
     * @returns Шифрованный буфер.
     */
    encryptOpus(frame: Buffer): Buffer;

    /**
     * @description Получает сериализованный ключевой пакет для обмена ключами.
     * @returns Буфер с сериализованным ключевым пакетом.
     */
    getSerializedKeyPackage(): Buffer;

    /**
     * @description Получает код верификации для указанного пользователя.
     * Используется для подтверждения подлинности ключей.
     * @param user_id - Идентификатор пользователя Discord.
     * @returns Промис, который разрешается строкой с кодом верификации.
     */
    getVerificationCode(user_id: string): Promise<string>;

    /**
     * @description Обрабатывает commit пакет, содержащий подтверждение ключей.
     * @param commit - Буфер с данными commit.
     */
    processCommit(commit: Buffer): void;

    /**
     * Обрабатывает предложения (proposals) по ключам.
     * @param type - Тип медиа: 0 для аудио, 1 для видео.
     * @param proposals - Буфер с предложениями.
     * @param recognizedUserIds - Опциональный список userId, которые распознаны.
     * @returns Результат обработки предложений.
     */
    processProposals(type: 0 | 1, proposals: Buffer, recognizedUserIds?: string[]): ProposalsResult;

    /**
     * @description Обрабатывает пакет welcome — инициализирующее сообщение сессии.
     * @param welcome - Буфер с данными welcome.
     */
    processWelcome(welcome: Buffer): void;

    /**
     * @description Статус готовности сессии к работе.
     */
    ready: boolean;

    /**
     * @description Переинициализирует сессию с новым протоколом, пользователем и каналом.
     * @param protocolVersion - Версия протокола.
     * @param user_id - Идентификатор пользователя Discord.
     * @param channel_id - Идентификатор голосового канала Discord.
     */
    reinit(protocolVersion: number, user_id: string, channel_id: string): void;

    /**
     * @description Сбрасывает текущее состояние сессии и очищает данные.
     */
    reset(): void;

    /**
     * @description Устанавливает внешний отправитель данных (например, для мультикаста).
     * @param externalSender - Буфер с идентификатором внешнего отправителя.
     */
    setExternalSender(externalSender: Buffer): void;

    /**
     * @description Включает или выключает режим пропуска (passthrough) для передачи данных напрямую.
     * @param passthrough - Флаг включения режима пропуска.
     * @param expiry - Время истечения действия режима в миллисекундах.
     */
    setPassthroughMode(passthrough: boolean, expiry: number): void;

    /**
     * @description Код голосовой приватности, используемый для шифрования.
     */
    voicePrivacyCode: string;
}

/**
 * @author SNIPPIK
 * @description Результат предложений
 * @interface ProposalsResult
 */
interface ProposalsResult {
    commit?: Buffer;
    welcome?: Buffer;
}

/**
 * @author SNIPPIK
 * @description Результат перехода
 * @interface TransitionResult
 */
interface TransitionResult {
    success: boolean;
    transition_id: number;
}

/**
 * @author SNIPPIK
 * @description Здесь будет находиться найденная библиотека, если она конечно будет найдена
 * @private
 */
let loaded_lib: any = null;

/**
 * @author SNIPPIK
 * @description Делаем проверку на наличие FFmpeg
 */
(async () => {
    const names = ["@snazzah/davey"];

    // Делаем проверку всех доступных библиотек
    for (const name of names) {
        try {
            const library = await import(name);
            delete require.cache[require.resolve(name)];

            DAVE_PROTOCOL_VERSION = library?.DAVE_PROTOCOL_VERSION as number;
            loaded_lib = library;
            return;
        } catch {}
    }

    // Выдаем предупреждение если нет библиотеки dave
    Logger.log("WARN", `[DAVE]: has not found library: @snazzah/davey`);
})();