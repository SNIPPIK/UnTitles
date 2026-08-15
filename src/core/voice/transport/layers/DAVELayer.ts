import { BaseLayer } from "#core/voice/transport/layers/BaseLayer.js";
import { MLSSession } from "#core/voice/structures/MLSSession.js";
import { VoiceAdapter } from "#core/voice/transport/adapter.js";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceWebSocket } from "#core/voice/index.js";

/**
 * @author SNIPPIK
 * @description Opcode для сообщения DAVE MLS Welcome (коммит + welcome).
 *              Используется как префикс для отправки данных коммита/приветствия.
 * @const
 * @private
 */
export const OPCODE_DAVE_MLS_WELCOME = new Uint8Array([VoiceOpcodes.DaveMlsCommitWelcome]);

/**
 * @author SNIPPIK
 * @description Opcode для сообщения DAVE MLS Key Package (отправка ключевого пакета).
 * @const
 * @private
 */
const OPCODE_DAVE_MLS_KEY = new Uint8Array([VoiceOpcodes.DaveMlsKeyPackage]);

/**
 * @author SNIPPIK
 * @description Слой DAVE (MLS), реализующий сквозное шифрование голосовых пакетов.
 *              Отвечает за создание и управление сессией MLS, обработку событий WebSocket,
 *              шифрование исходящих аудио фреймов и отправку ключевых материалов.
 * @extends BaseLayer<MLSSession>
 */
export class DAVELayer extends BaseLayer<MLSSession> {
    /**
     * @description Индикатор готовности слоя к шифрованию.
     * @returns `true`, если сессия существует, готова (ready), не находится в переходе,
     *          и метод `encrypt` доступен. Иначе `false`.
     */
    public get ready(): boolean {
        return this._client && this._client.status === 3 && !this._client.isTransitioning;
    };

    /**
     * @description Конструктор слоя DAVE.
     * @param adapter - Адаптер голосового соединения, предоставляющий информацию о состоянии
     *                  (user_id, channel_id, список клиентов и т.д.).
     */
    public constructor(private adapter: VoiceAdapter) {
        super();
    };

    /**
     * @description Шифрует массив аудио фреймов с использованием текущей MLS-сессии.
     * @param frames - Массив исходных (не зашифрованных) Opus-фреймов.
     * @returns Массив зашифрованных фреймов (каждый элемент – Buffer).
     * @throws {Error} Если шифрование не удалось
     *
     * @remarks
     * В оригинале был закомментирован механизм повторных попыток (retries),
     * но сейчас он отключен. При неудаче выбрасывается исключение.
     */
    public packet = (frames: Buffer[]) => {
        if (!this._client) return null;

        // Вызов метода encrypt сессии; возвращает массив зашифрованных пакетов или null.
        return this._client.encrypt(frames);
    };

    /**
     * @description Создаёт и инициализирует MLS-сессию, подписывается на события WebSocket,
     *              и настраивает обработку сообщений протокола DAVE.
     * @param version - Текущая версия протокола DAVE (передаётся извне).
     * @param ws - Экземпляр голосового WebSocket, через который будут отправляться и приниматься
     *             сообщения DAVE.
     *
     * @remarks
     * Если активная сессия уже существует, она уничтожается перед созданием новой.
     * Метод регистрирует обработчики:
     * - `"key"` – отправка ключевого пакета при инициализации.
     * - `"invalidateTransition"` – уведомление сервера о невалидном переходе.
     * - `"daveSession"` – обработка сообщений WebSocket с операциями DAVE.
     * - `"binary"` – обработка бинарных сообщений (external sender, proposals, commit, welcome).
     */
    public create = (version: number, ws: VoiceWebSocket) => {
        const { user_id, channel_id } = this.adapter.packet.state;

        // Если уже есть активная сессия, уничтожаем её перед созданием новой.
        if (this._client) {
            this._client.destroy();
            this._client = null;
        }

        // Создаём новую сессию MLS.
        const session = (this._client = new MLSSession(version, user_id, channel_id));

        /**
         * Обработчик события `"key"`: вызывается, когда сессия генерирует новый KeyPackage.
         * Отправляет его через WebSocket с префиксом-опкодом.
         */
        session.on("key", async (key) => {
            ws.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
        });

        /**
         * Обработчик события `"invalidateTransition"`: вызывается, когда переход признан недействительным.
         * Отправляет серверу сообщение с идентификатором перехода.
         */
        session.on("invalidateTransition", async (transitionId) => {
            ws.packet = {
                op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                d: {
                    transition_id: transitionId
                }
            };
        });

        // Запускаем (пере)инициализацию сессии.
        session.reinit();
    };
}