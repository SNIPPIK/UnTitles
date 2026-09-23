import type { VoiceDavePrepareEpochData, VoiceDavePrepareTransitionData } from "discord-api-types/voice/v8";
import { iType, MLSSession as NativeMLSSession } from "#native";
import { TypedEmitter } from "#structures";

/// Максимальная поддерживаемая версия протокола DAVE.
const MAX_DAVE_PROTOCOL = 1;

/// Время (сек), в течение которого разрешён passthrough-режим при переходе.
const TRANSITION_EXPIRY = 10;

/// Результат обработки перехода от нативного слоя.
interface NativeTransitionResult {
    transition_id: number;
    success: boolean;
    invalidated: boolean;
}

/// Обёртка над нативной MLS-сессией (DAVE).
///
/// Управляет жизненным циклом E2EE для голосового канала: инициализация,
/// обмен ключами, переходы между версиями протокола, обработка proposals/
/// commit/welcome, шифрование исходящих Opus-пакетов.
///
/// Нативная сессия создаётся лениво при первом обращении к `session`
/// или при вызове методов, которым требуется активное состояние.
export class MLSSession extends TypedEmitter<ClientMLSEvents> {
    /// `true`, если сессия уничтожена — либо на уровне обёртки,
    /// либо на уровне нативного объекта.
    public get destroyed(): boolean {
        return this._destroyed
            || (this.session?.destroyed ?? false);
    }

    /// Идентификатор последнего успешно выполненного перехода.
    public get lastTransition_id(): number | undefined {
        return this.session?.lastTransitionId;
    }

    /// `true`, если сессия переинициализируется после ошибки перехода.
    public get reinitializing(): boolean {
        return this.session?.reinitializing
            ?? this._reinitializing;
    }

    /// `true`, если в данный момент выполняется смена версии протокола.
    public get isTransitioning(): boolean {
        return this.session?.isTransitioning ?? false;
    }

    /// Текущий внутренний статус MLS-сессии.
    public get status(): number | undefined {
        return this.session?.status;
    }

    /// `true`, если нативная сессия готова к шифрованию.
    public get ready(): boolean {
        return this.session?.ready ?? false;
    }

    /// Максимальная поддерживаемая версия DAVE.
    public static get max_version(): number {
        return MAX_DAVE_PROTOCOL;
    }

    /// Флаг уничтожения на уровне обёртки (не нативного объекта).
    private _destroyed = false;

    /// Флаг переинициализации до момента создания нативной сессии.
    private _reinitializing = false;

    /// Внешний отправитель, сохранённый до появления нативной сессии.
    private _pendingExternalSender: Buffer | null = null;

    /// Нативная MLS-сессия. Создаётся лениво.
    public session: iType<typeof NativeMLSSession> = null;

    /// @param version    — начальная версия протокола DAVE.
    /// @param user_id    — идентификатор текущего пользователя.
    /// @param channel_id — идентификатор голосового канала.
    constructor(
        private version: number,
        public user_id: string,
        public channel_id: string,
    ) {
        super();
    }

    // ---------------------------------------------------------------------
    // External sender
    // ---------------------------------------------------------------------

    /// Устанавливает внешнего отправителя.
    ///
    /// Если нативная сессия уже создана — передаёт значение напрямую,
    /// иначе сохраняет и применит при создании.
    public set externalSender(
        externalSender: Buffer,
    ) {
        if (this.session) {
            this.session.externalSender =
                externalSender;
        } else {
            this._pendingExternalSender =
                externalSender;
        }
    }

    // ---------------------------------------------------------------------
    // Epoch
    // ---------------------------------------------------------------------

    /// Обрабатывает данные подготовки новой эпохи.
    ///
    /// Игнорируется во время переинициализации и для эпох кроме 1.
    /// Обновляет версию протокола, при необходимости создаёт сессию
    /// и эмитит событие `key`, если получен новый key-package.
    public set prepareEpoch(
        data: VoiceDavePrepareEpochData,
    ) {
        if (this.reinitializing) {
            return;
        }

        // Только первая эпоха вызывает инициализацию.
        if (data.epoch !== 1) {
            return;
        }

        this.version = data.protocol_version;

        if (!this.session) {
            this.createSession();
        }

        const key =
            this.session!.prepareEpoch(
                data.epoch,
                data.protocol_version,
            );

        // Оповещаем внешний код о новом key-package.
        if (key) {
            this.emit("key", key);
        }
    }

    // ---------------------------------------------------------------------
    // Invalid transition recovery
    // ---------------------------------------------------------------------

    /// Запускает восстановление после невалидного перехода.
    ///
    /// Устанавливает флаг переинициализации, эмитит `invalidateTransition`
    /// и делегирует нативный вызов. Игнорируется во время переинициализации.
    public set recoverFromInvalidTransition(
        id: number,
    ) {
        if (this.reinitializing) {
            return;
        }

        this._reinitializing = true;

        if (!this.session) {
            this.createSession();
        }

        this.emit(
            "invalidateTransition",
            id,
        );

        const key =
            this.session!.recoverFromInvalidTransition(
                id,
            );

        // Оповещаем внешний код о новом key-package.
        if (key) {
            this.emit("key", key);
        }
    }

    // ---------------------------------------------------------------------
    // Proposals
    // ---------------------------------------------------------------------

    /// Обрабатывает proposals от другого участника.
    ///
    /// Первый байт payload — тип операции, остальное — данные.
    /// Возвращает commit (и welcome, если применимо) или `null`,
    /// если нативная сессия не создана или commit не требуется.
    public processProposals = (
        payload: Buffer,
        connectedClients: readonly string[],
    ): Buffer | null => {
        if (!this.session) {
            return null;
        }

        // Минимум — 1 байт под тип операции.
        if (payload.length < 1) {
            return null;
        }

        // Тип операции.
        const type =
            payload.readUInt8(0);

        // Данные предложений.
        const data =
            payload.subarray(1);

        const result =
            this.session.processProposals(
                type,
                data,
                [...connectedClients],
            );

        // Если коммит не требуется — ничего не возвращаем.
        if (!result.commit) {
            return null;
        }

        // Склеиваем commit и welcome, если welcome присутствует.
        return result.welcome
            ? Buffer.concat([
                result.commit,
                result.welcome,
            ])
            : result.commit;
    };

    // ---------------------------------------------------------------------
    // Commit
    // ---------------------------------------------------------------------

    /// Обрабатывает commit от другого участника.
    ///
    /// При отсутствии сессии возвращает `success: false` с извлечённым
    /// transition_id (если payload достаточно длинный).
    /// При `invalidated` эмитит событие `invalidateTransition`.
    public processCommit = (
        payload: Buffer,
    ) => {
        if (!this.session) {
            // transition_id хранится в первых 2 байтах payload.
            const transition_id =
                payload.length >= 2
                    ? payload.readUInt16BE(0)
                    : 0;

            return {
                transition_id,
                success: false,
            };
        }

        const result =
            this.session.processCommit(
                payload,
            ) as NativeTransitionResult;

        // Нативная сессия сообщила, что переход невалиден.
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

    /// Обрабатывает welcome от другого участника.
    ///
    /// Аналогичен `processCommit`, но для присоединения к группе.
    public processWelcome = (
        payload: Buffer,
    ) => {
        if (!this.session) {
            const transition_id =
                payload.length >= 2
                    ? payload.readUInt16BE(0)
                    : 0;

            return {
                transition_id,
                success: false,
            };
        }

        const result =
            this.session.processWelcome(
                payload,
            ) as NativeTransitionResult;

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

    /// Переинициализирует сессию с текущей версией протокола.
    ///
    /// Применяет отложенный external sender (если был сохранён),
    /// эмитит новый `key`. Для версии 0 включает passthrough-режим.
    public reinit = (): void => {
        // Уничтоженную сессию не переинициализируем.
        if (this._destroyed) {
            return;
        }

        if (!this.session) {
            this.createSession();
        }

        // Запускаем нативный reinit, получаем возможный key-package.
        const result =
            this.session!.reinit()

        // Применяем отложенный external sender, если он был.
        if (this._pendingExternalSender) {
            this.session!.externalSender =
                this._pendingExternalSender;

            this._pendingExternalSender = null;
        }

        // Оповещаем о новом key-package.
        if (result) {
            this.emit("key", result);
        }

        // Для нулевой версии включаем passthrough с ограничением по времени.
        if (this.version === 0) {
            this.session!.setPassthroughMode(
                true,
                TRANSITION_EXPIRY,
            );
        }
    };

    // ---------------------------------------------------------------------
    // Transitions
    // ---------------------------------------------------------------------

    /// Подготавливает переход на другую версию протокола.
    ///
    /// Возвращает `true`, если переход требует последующего
    /// `executeTransition`.
    public prepareTransition = (
        data: VoiceDavePrepareTransitionData,
    ): boolean => {
        if (!this.session) {
            this.createSession();
        }

        return this.session!.prepareTransition(
            data.transition_id,
            data.protocol_version,
        );
    };

    /// Выполняет ранее подготовленный переход.
    ///
    /// Возвращает `false`, если сессия отсутствует или переход неизвестен.
    public executeTransition = (
        transition_id: number,
    ): boolean => {
        if (!this.session) {
            return false;
        }

        return this.session.executeTransition(
            transition_id,
        );
    };

    // ---------------------------------------------------------------------
    // Encrypt
    // ---------------------------------------------------------------------

    /// Шифрует массив Opus-пакетов.
    ///
    /// Возвращает `null`, если шифрование невозможно:
    /// - версия протокола 0 (passthrough);
    /// - сессия не готова;
    /// - идёт переход;
    /// - идёт переинициализация.
    public encrypt = (
        packets: Buffer[],
    ): Buffer[] | null => {
        // Passthrough-режим: без шифрования.
        if (this.version === 0) {
            return null;
        }

        // Сессия не готова к работе.
        if (!this.session?.ready) {
            return null;
        }

        // Не шифруем во время переходов/переинициализации —
        // состояние ключей нестабильно.
        if (this.session.isTransitioning) {
            return null;
        }

        if (this.session.reinitializing) {
            return null;
        }

        return this.session.encrypt(
            packets,
        );
    };

    // ---------------------------------------------------------------------
    // Reset
    // ---------------------------------------------------------------------

    /// Сбрасывает состояние нативной сессии без её уничтожения.
    public reset(): void {
        this.session?.reset();
    }

    // ---------------------------------------------------------------------
    // Destroy
    // ---------------------------------------------------------------------

    /// Полностью уничтожает обёртку и нативную сессию.
    ///
    /// Идемпотентен. Ошибки уничтожения нативного слоя эмитятся
    /// как событие `error`, чтобы не прерывать очистку остальных полей.
    public destroy = () => {
        // Защита от повторного вызова.
        if (this._destroyed) {
            return;
        }

        this._destroyed = true;

        try {
            this.session?.destroy();
        } catch (error) {
            // Ошибку уничтожения пробрасываем наружу событием.
            this.emit(
                "error",
                Error(
                    `[Critical destroy error]\n${error}`,
                ),
            );
        }

        // Убираем слушателей базового эмиттера.
        super.destroy();

        // Обнуляем все ссылки для помощи GC.
        this.session = null;

        this._reinitializing = false;
        this._pendingExternalSender = null;

        this.user_id = null as any;
        this.channel_id = null as any;
    };

    // ---------------------------------------------------------------------
    // Native creation
    // ---------------------------------------------------------------------

    /// Лениво создаёт нативную MLS-сессию.
    ///
    /// Если был сохранён external sender — применяет его сразу после создания.
    private createSession(): void {
        // Сессия уже существует — ничего не делаем.
        if (this.session) {
            return;
        }

        // Создаём нативную сессию с текущими параметрами.
        this.session =
            new NativeMLSSession(
                this.version,
                this.user_id,
                this.channel_id,
            );

        // Применяем отложенный external sender, если он есть.
        if (this._pendingExternalSender) {
            this.session.externalSender =
                this._pendingExternalSender;

            this._pendingExternalSender = null;
        }
    }
}

/// События, эмитируемые MLS-сессией.
export interface ClientMLSEvents {
    /// Ошибка критического характера (например, при уничтожении).
    "error": (error: Error) => void;

    /// Отладочное сообщение.
    "debug": (message: string) => void;

    /// Новый key-package, который нужно передать другим участникам.
    "key": (message: Buffer) => void;

    /// Текущий переход признан невалидным; требуется переинициализация.
    "invalidateTransition": (
        transitionId: number,
    ) => void;
}