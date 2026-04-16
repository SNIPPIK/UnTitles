import { BaseLayer } from "#core/voice/transport/layers/BaseLayer";
import { MLSSession } from "#core/voice/structures/MLSSession";
import { VoiceAdapter } from "#core/voice/transport/adapter";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceWebSocket } from "#core/voice";

/**
 * @author SNIPPIK
 * @description Opcode для сообщения DAVE MLS Welcome (коммит + welcome).
 *              Используется как префикс для отправки данных коммита/приветствия.
 * @const
 * @private
 */
const OPCODE_DAVE_MLS_WELCOME = new Uint8Array([VoiceOpcodes.DaveMlsCommitWelcome]);

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
        if (this._client?.session) {
            // Сессия должна быть готова, не должна быть в состоянии перехода,
            // и метод encrypt должен существовать (проверка на наличие).
            if (!this._client.session.ready || this._client.isTransitioning || !this._client.encrypt) {
                return false;
            }
        }
        return true;
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
        // Вызов метода encrypt сессии; возвращает массив зашифрованных пакетов или null.
        let packets = this._client.encrypt(frames);

        /*let attempts = 0;
        while (!packets && attempts < BaseLayer.MAX_RETRIES) {
            attempts++;
            packets = this._dave.encrypt(frames);
        }*/

        if (!packets) {
            throw new Error("DAVE encryption failed after retries");
        }
        return packets;
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
        session.on("key", (key) => {
            ws.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
        });

        /**
         * Обработчик события `"invalidateTransition"`: вызывается, когда переход признан недействительным.
         * Отправляет серверу сообщение с идентификатором перехода.
         */
        session.on("invalidateTransition", (transitionId) => {
            ws.packet = {
                op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                d: {
                    transition_id: transitionId,
                },
            };
        });

        /**
         * Обработчик сообщений WebSocket с операциями DAVE (тип `"daveSession"`).
         * Обрабатывает:
         * - `DavePrepareTransition` – подготовка перехода (возвращает DaveTransitionReady)
         * - `DaveExecuteTransition` – выполнение перехода
         * - `DavePrepareEpoch` – подготовка новой эпохи
         */
        ws.on("daveSession", ({ op, d }) => {
            switch (op) {
                case VoiceOpcodes.DavePrepareTransition: {
                    const sendReady = session.prepareTransition(d);
                    if (sendReady) {
                        ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id: d.transition_id },
                        };
                    }
                    return;
                }
                case VoiceOpcodes.DaveExecuteTransition: {
                    session.executeTransition(d.transition_id);
                    return;
                }
                case VoiceOpcodes.DavePrepareEpoch: {
                    session.prepareEpoch = d;
                    return;
                }
            }
        });

        /**
         * Обработчик бинарных сообщений WebSocket (тип `"binary"`).
         * Обрабатывает:
         * - `DaveMlsExternalSender` – установка внешнего отправителя.
         * - `DaveMlsProposals` – обработка предложений MLS (отправляет welcome/commit).
         * - `DaveMlsAnnounceCommitTransition` – обработка коммита для перехода.
         * - `DaveMlsWelcome` – обработка welcome-сообщения.
         */
        ws.on("binary", ({ op, payload }) => {
            switch (op) {
                case VoiceOpcodes.DaveMlsExternalSender: {
                    session.externalSender = payload;
                    return;
                }
                case VoiceOpcodes.DaveMlsProposals: {
                    const proposal = session.processProposals(payload, this.adapter.clients.array);
                    if (proposal) {
                        ws.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, proposal]);
                    }
                    return;
                }
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition: {
                    const { transition_id, success } = session.processCommit(payload);
                    if (success && transition_id !== 0) {
                        ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }
                    return;
                }
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transition_id, success } = session.processWelcome(payload);
                    if (success && transition_id !== 0) {
                        ws.packet = {
                            op: VoiceOpcodes.DaveTransitionReady,
                            d: { transition_id },
                        };
                    }
                    return;
                }
            }
        });

        // Запускаем (пере)инициализацию сессии.
        session.reinit();
    };

    /**
     * @description Уничтожает слой DAVE, освобождая ресурсы сессии.
     *              Вызывается при завершении работы голосового соединения.
     */
    public destroy = () => {
        this._client.destroy();
        this._client = null;
    };
}