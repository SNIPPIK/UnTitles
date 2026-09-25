import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { iType, MLSSession as NativeMLSSession } from "#native";
import { TypedEmitter } from "#structures";

/**
 * Максимальная поддерживаемая версия протокола DAVE.
 * Нужна для проверки входящих данных `prepareEpoch` и `prepareTransition`.
 */
const MAX_DAVE_PROTOCOL = 1;

/**
 * Время (в секундах), в течение которого разрешён режим без шифрования
 * при переходе на версию 0. После этого срока шифрование включается принудительно.
 */
const TRANSITION_EXPIRY = 10;

/**
 * Результат обработки перехода, который возвращает нативный слой.
 * Содержит идентификатор перехода, признак успеха и признак того,
 * что переход оказался недействительным и сессию нужно запустить заново.
 */
interface NativeTransitionResult {
    transition_id: number;
    success: boolean;
    invalidated: boolean;
}

/**
 * Обёртка над нативной MLS-сессией (DAVE).
 *
 * Отвечает за весь жизненный цикл шифрования E2EE в голосовом канале:
 *  - первичный запуск и повторный запуск сессии;
 *  - обмен ключами через событие `key`;
 *  - обработку proposals / commit / welcome от других участников;
 *  - переходы между версиями протокола;
 *  - шифрование исходящих Opus-пакетов.
 *
 * Нативная сессия создаётся не сразу, а при первом вызове метода, которому
 * нужно рабочее состояние, либо при установке `externalSender`. До этого
 * момента часть данных (например, external sender) хранится в полях обёртки
 * и применяется позже.
 */
export class MLSSession extends TypedEmitter<ClientMLSEvents> {
    /**
     * `true`, если сессия уничтожена — либо сама обёртка, либо нативный объект.
     * Уничтоженную сессию нельзя запустить заново.
     */
    public get destroyed(): boolean {
        return this._destroyed || (this.session?.destroyed ?? false);
    };

    /**
     * Идентификатор последнего успешно выполненного перехода.
     * `undefined`, если нативная сессия ещё не создана.
     */
    public get lastTransition_id(): number | undefined {
        return this.session?.lastTransitionId;
    };

    /**
     * `true`, если сессия сейчас запускается заново после недействительного
     * перехода.
     *
     * Пока нативная сессия не создана, значение берётся из локального флага
     * `_reinitializing`; после — из состояния нативного объекта.
     */
    public get reinitializing(): boolean {
        return this.session?.reinitializing ?? this._reinitializing;
    };

    /**
     * `true`, если сейчас идёт смена версии протокола.
     * На время перехода шифрование приостанавливается.
     */
    public get isTransitioning(): boolean {
        return this.session?.isTransitioning ?? false;
    }

    /**
     * Текущий внутренний статус MLS-сессии (см. native-реализацию).
     * `undefined`, если сессия ещё не создана.
     */
    public get status(): number | undefined {
        return this.session?.status;
    };

    /**
     * `true`, если нативная сессия готова принимать пакеты на шифрование.
     */
    public get ready(): boolean {
        return this.session?.ready ?? false;
    };

    /**
     * Максимальная поддерживаемая версия протокола DAVE.
     * Открыта наружу статически, чтобы внешний код мог проверять совместимость.
     */
    public static get max_version(): number {
        return MAX_DAVE_PROTOCOL;
    };

    /**
     * Флаг уничтожения на уровне обёртки.
     * Отличается от `session.destroyed` тем, что выставляется даже если
     * нативная сессия ещё не была создана.
     */
    private _destroyed = false;

    /**
     * Локальный флаг повторного запуска, который работает до того момента,
     * пока нативная сессия не будет создана и не начнёт отдавать своё состояние.
     */
    private _reinitializing = false;

    /**
     * Временное хранилище для external sender, полученного до создания
     * нативной сессии. Применяется автоматически при первом `createSession()`
     * или `reinit()`.
     */
    private _pendingExternalSender: Buffer | null = null;

    /**
     * Нативная MLS-сессия. Создаётся не сразу.
     * `null`, если сессия ещё не создана или уже уничтожена.
     */
    public session: iType<typeof NativeMLSSession> = null;

    /**
     * @param version    — начальная версия протокола DAVE.
     * @param user_id    — идентификатор текущего пользователя.
     * @param channel_id — идентификатор голосового канала.
     */
    constructor(private version: number, public user_id: string, public channel_id: string) { super(); };

    // ---------------------------------------------------------------------
    // External sender
    // ---------------------------------------------------------------------

    /**
     * Устанавливает external sender для MLS-сессии.
     *
     * Если нативная сессия уже создана — значение передаётся напрямую,
     * иначе сохраняется и будет применено при создании или повторном
     * запуске сессии. Так можно принимать external sender раньше, чем
     * нативный слой будет готов.
     */
    public set externalSender(externalSender: Buffer) {
        if (this.session) this.session.externalSender = externalSender;
        else this._pendingExternalSender = externalSender;
    };

    // ---------------------------------------------------------------------
    // Epoch
    // ---------------------------------------------------------------------

    /**
     * Обрабатывает данные подготовки новой эпохи (`prepareEpoch`).
     *
     * Логика:
     *  - игнорируется во время повторного запуска (состояние ключей нестабильно);
     *  - реагирует только на epoch === 1, потому что именно первая эпоха
     *    запускает MLS-сессию;
     *  - обновляет локальную версию протокола из входящих данных;
     *  - при необходимости создаёт нативную сессию;
     *  - отправляет событие `key`, если нативный слой вернул новый key-package.
     */
    public set prepareEpoch(data: VoiceDavePrepareEpochData) {
        if (this.reinitializing) return;

        // Только первая эпоха запускает инициализацию.
        else if (data.epoch !== 1) return;

        this.version = data.protocol_version;
        if (!this.session) this.createSession();

        const key = this.session!.prepareEpoch(
            data.epoch,
            data.protocol_version,
        );

        // Сообщаем внешнему коду о новом key-package.
        if (key) this.emit("key", key);
    };

    // ---------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------

    /**
     * Обрабатывает proposals от другого участника.
     *
     * Формат payload: `[1 байт — тип операции][N байт — данные proposals]`.
     * Тип операции передаётся в нативный слой отдельным аргументом.
     *
     * @returns
     *  - `commit` (и `welcome`, если нативный слой его вернул), если нужна
     *    ответная рассылка;
     *  - `null`, если нативная сессия не создана, payload пуст или commit
     *    не требуется.
     */
    public processProposals = (payload: Buffer, connectedClients: readonly string[]): Buffer | null => {
        if (!this.session) return null;

        // Минимум — 1 байт под тип операции.
        else if (payload.length < 1) return null;


        // Тип операции.
        const type = payload.readUInt8(0);

        // Данные предложений.
        const data = payload.subarray(1);

        const result = this.session.processProposals(
            type, data, [...connectedClients],
        );

        // Если commit не требуется — ничего не возвращаем.
        if (!result.commit) return null;

        // Склеиваем commit и welcome в один payload для рассылки.
        return result.welcome ? Buffer.concat([result.commit, result.welcome]) : result.commit;
    };

    // ---------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------

    /**
     * Обрабатывает commit от другого участника.
     *
     * Если нативная сессия ещё не создана, извлекает `transition_id`
     * из первых двух байт payload и возвращает `success: false` — так
     * внешний код может корректно ответить на переход, не имея активной сессии.
     *
     * Если нативный слой сообщил, что переход недействителен, отправляет
     * событие `invalidateTransition` — сигнал о необходимости восстановления.
     */
    public processCommit = (payload: Buffer) => {
        if (!this.session) {
            // transition_id хранится в первых 2 байтах payload (big-endian).
            const transition_id = payload.length >= 2 ? payload.readUInt16BE(0): 0;

            return {
                transition_id,
                success: false,
            };
        }

        const result = this.session.processCommit( payload) as NativeTransitionResult;

        // Нативная сессия сообщила, что переход недействителен.
        if (result.invalidated) {
            this.emit(
                "invalidateTransition",
                result.transition_id,
            );
        }

        return {
            transition_id:
            result.transition_id,
            success:
            result.success,
        };
    };

    // ---------------------------------------------------------------------
    // Welcome
    // ---------------------------------------------------------------------

    /**
     * Обрабатывает welcome от другого участника.
     *
     * Работает так же, как `processCommit`, но для случая присоединения
     * к существующей MLS-группе через welcome-сообщение.
     */
    public processWelcome = (payload: Buffer) => {
        if (!this.session) {
            const transition_id = payload.length >= 2 ? payload.readUInt16BE(0) : 0;

            return {
                transition_id,
                success: false,
            };
        }

        const result = this.session.processWelcome(payload) as NativeTransitionResult;

        if (result.invalidated) {
            this.emit(
                "invalidateTransition",
                result.transition_id,
            );
        }

        return {
            transition_id:
            result.transition_id,
            success:
            result.success,
        };
    };

    // ---------------------------------------------------------------------
    // Reinit
    // ---------------------------------------------------------------------

    /**
     * Запускает нативную сессию заново с текущей версией протокола.
     *
     * Порядок действий:
     *  1. Защита от вызова на уничтоженной сессии.
     *  2. Создание нативной сессии, если её ещё нет.
     *  3. Вызов нативного `reinit()`, получение возможного key-package.
     *  4. Применение отложенного `externalSender`, если он был сохранён.
     *  5. Отправка события `key`, если нативный слой вернул новый key-package.
     *  6. Для version === 0 — включение режима без шифрования на
     *     TRANSITION_EXPIRY секунд (пока ключи ещё не согласованы).
     */
    public reinit = (): void => {
        // Уничтоженную сессию заново не запускаем.
        if (this._destroyed) return;
        else if (!this.session) this.createSession();

        // Запускаем нативный reinit, получаем возможный key-package.
        const result = this.session!.reinit()

        // Применяем отложенный external sender, если он был.
        if (this._pendingExternalSender) {
            this.session!.externalSender =
                this._pendingExternalSender;

            this._pendingExternalSender = null;
        }

        // Сообщаем о новом key-package.
        if (result) this.emit("key", result);

        // Для нулевой версии включаем режим без шифрования с ограничением по времени.
        if (this.version === 0) this.session!.setPassthroughMode(true, TRANSITION_EXPIRY);
    };

    // ---------------------------------------------------------------------
    // Transitions
    // ---------------------------------------------------------------------

    /**
     * Готовит переход на другую версию протокола DAVE.
     *
     * @returns `true`, если после этого нужно вызвать `executeTransition`
     *          с тем же `transition_id`.
     */
    public prepareTransition = (data: VoiceDavePrepareTransitionData): boolean => {
        if (!this.session) this.createSession();
        return this.session!.prepareTransition(
            data.transition_id,
            data.protocol_version,
        );
    };

    /**
     * Выполняет ранее подготовленный переход.
     *
     * @returns `false`, если нативная сессия не создана или переход
     *          с таким `transition_id` неизвестен.
     */
    public executeTransition = (transition_id: number): boolean => {
        if (!this.session) return false;
        return this.session.executeTransition(
            transition_id,
        );
    };

    // ---------------------------------------------------------------------
    // Encrypt
    // ---------------------------------------------------------------------

    /**
     * Шифрует массив исходящих Opus-пакетов.
     *
     * Возвращает `null` (без шифрования), если выполняется любое из условий:
     *  - версия протокола 0 — режим без шифрования;
     *  - нативная сессия не создана или не готова;
     *  - идёт переход между версиями;
     *  - идёт повторный запуск сессии.
     *
     * Последние два условия важны: во время смены ключей шифрование
     * нестабильно и может привести к рассинхронизации с другими участниками.
     */
    public encrypt = (packets: Buffer[]): Buffer[] | null => {
        // Режим без шифрования.
        if (this.version === 0) return null;

        // Сессия не готова к работе.
        else if (!this.session?.ready) return null;

            // Не шифруем во время переходов и повторного запуска —
        // состояние ключей нестабильно.
        else if (this.session.isTransitioning) return null;
        else if (this.session.reinitializing) return null;

        return this.session.encrypt(packets);
    };

    // ---------------------------------------------------------------------
    // Reset
    // ---------------------------------------------------------------------

    /**
     * Сбрасывает состояние нативной сессии, не уничтожая её.
     * Пригодится, чтобы использовать объект заново после ошибок.
     */
    public reset(): void {
        this.session?.reset();
    };

    // ---------------------------------------------------------------------
    // Destroy
    // ---------------------------------------------------------------------

    /**
     * Полностью уничтожает обёртку и нативную сессию.
     *
     * Гарантии:
     *  - повторный вызов ничего не делает;
     *  - ошибки нативного `destroy` не прерывают очистку, а передаются
     *    наружу событием `error`;
     *  - все ссылки обнуляются, чтобы помочь сборщику мусора.
     */
    public destroy = () => {
        // Защита от повторного вызова.
        if (this._destroyed) return;
        this._destroyed = true;

        try {
            this.session?.destroy();
        } catch (error) {
            // Ошибку уничтожения передаём наружу событием,
            // чтобы не прерывать очистку остальных полей.
            this.emit("error", Error(
                    `[Critical destroy error]\n${error}`,
                )
            );
        }

        // Убираем слушателей базового эмиттера событий.
        super.destroy();

        // Обнуляем все ссылки, чтобы помочь сборщику мусора.
        this.session = null;

        this._reinitializing = false;
        this._pendingExternalSender = null;

        this.user_id = null as any;
        this.channel_id = null as any;
    };

    // ---------------------------------------------------------------------
    // Native creation
    // ---------------------------------------------------------------------

    /**
     * Создаёт нативную MLS-сессию по необходимости.
     *
     * Если раньше был сохранён `externalSender` (например, он пришёл
     * до готовности нативного слоя) — применяет его сразу после создания.
     *
     * Повторный вызов при уже существующей сессии ничего не делает.
     */
    private createSession(): void {
        // Сессия уже существует — ничего не делаем.
        if (this.session) return;

        // Создаём нативную сессию с текущими параметрами.
        this.session = new NativeMLSSession(
            this.version,
            this.user_id,
            this.channel_id
        );

        // Применяем отложенный external sender, если он есть.
        if (this._pendingExternalSender) {
            this.session.externalSender = this._pendingExternalSender;
            this._pendingExternalSender = null;
        }
    }
}

/**
 * События, которые отправляет MLS-сессия.
 */
export interface ClientMLSEvents {
    /**
     * Ошибка критического характера (например, при уничтожении нативной сессии).
     * Не прерывает работу вызывающего кода, но требует внимания.
     */
    "error": (error: Error) => void;

    /**
     * Отладочное сообщение для поиска проблем с E2EE.
     */
    "debug": (message: string) => void;

    /**
     * Новый key-package, который нужно передать другим участникам канала
     * через сигнальный канал Discord.
     */
    "key": (message: Buffer) => void;

    /**
     * Текущий переход признан недействительным.
     * Внешний код должен запустить MLS-сессию заново.
     */
    "invalidateTransition": (transitionId: number) => void;
}