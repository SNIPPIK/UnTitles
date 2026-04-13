import { BaseLayer } from "#core/voice/transport/layers/BaseLayer";
import { MLSSession } from "#core/voice/structures/MLSSession";
import { VoiceAdapter } from "#core/voice/transport/adapter";
import { VoiceOpcodes } from "discord-api-types/voice/v8";
import { VoiceWebSocket } from "#core/voice";

/**
 * @author SNIPPIK
 * @description Opcode dave mls приветствия
 * @const OPCODE_DAVE_MLS_WELCOME
 * @private
 */
const OPCODE_DAVE_MLS_WELCOME = new Uint8Array([VoiceOpcodes.DaveMlsCommitWelcome]);

/**
 * @author SNIPPIK
 * @description Opcode dave mls ключа пакета
 * @const OPCODE_DAVE_MLS_KEY
 * @private
 */
const OPCODE_DAVE_MLS_KEY = new Uint8Array([VoiceOpcodes.DaveMlsKeyPackage]);

export class DAVELayer extends BaseLayer<Buffer[]> {
    /**
     * @description Клиент Dave, для работы сквозного шифрования
     * @public
     */
    public _dave: MLSSession | null;

    /**
     * @description Готовность DAVE слоя
     * @public
     */
    public get ready(): boolean {
        if (this._dave?.session) {
            if (!this._dave.session.ready || this._dave.isTransitioning || !this._dave.encrypt) {
                return false;
            }
        }

        return true;
    };

    public constructor(
        private adapter: VoiceAdapter,
        private ws: VoiceWebSocket
    ) {
        super();
    };

    /**
     * @description Пробуем обернуть пакет с помощью MLS
     * @param frames
     * @public
     */
    public packet = (frames: Buffer[]) => {
        let packets = this._dave.encrypt(frames);
        /*let attempts = 0;

        // Даем шанс на повтор
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
     * @description Создание ключевого обьекта
     * @param version - Текущая версия DAVE
     * @public
     */
    public create = (version: number) => {
        const { user_id, channel_id } = this.adapter.packet.state;
        const ws = this.ws;

        // Если уже есть активная сессия
        if (this._dave) {
            this._dave.destroy();
            this._dave = null;
        }

        // Создаем сессию
        const session = this._dave = new MLSSession(version, user_id, channel_id);

        /**
         * @description Создаем слушателя события для получения ключа
         * @event
         */
        session.on("key", (key) => {
            // Если голосовое подключение готово
            ws.packet = Buffer.concat([OPCODE_DAVE_MLS_KEY, key]);
        });

        /**
         * @description Сообщаем что мы тоже хотим использовать DAVE
         * @event
         */
        session.on("invalidateTransition", (transitionId) => {
            // Если голосовое подключение готово
            ws.packet = {
                op: VoiceOpcodes.DaveMlsInvalidCommitWelcome,
                d: {
                    transition_id: transitionId
                }
            };
        });

        /**
         * @description Получаем коды dave от WebSocket
         * @code 21-31
         */
        ws.on("daveSession", ({op, d}) => {
            switch (op) {
                // Предстоит понижение версии протокола DAVE
                case VoiceOpcodes.DavePrepareTransition: {
                    const sendReady = session.prepareTransition(d);

                    if (sendReady) ws.packet = {
                        op: VoiceOpcodes.DaveTransitionReady,
                        d: {
                            transition_id: d.transition_id
                        }
                    };
                    return;
                }

                // Выполнить ранее объявленный переход протокола
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
         * @description Получаем буфер от webSocket
         * @code 21-31
         */
        ws.on("binary", ({op, payload}) => {
            switch (op) {
                // Учетные данные и открытый ключ для внешнего отправителя MLS
                case VoiceOpcodes.DaveMlsExternalSender: {
                    this._dave.externalSender = payload;
                    return;
                }

                // Предложения MLS, которые будут добавлены или отозваны
                case VoiceOpcodes.DaveMlsProposals: {
                    const proposal = this._dave.processProposals(payload, this.adapter.clients.array);

                    // Меняем протокол DAVE
                    if (proposal) ws.packet = Buffer.concat([OPCODE_DAVE_MLS_WELCOME, proposal]);
                    return;
                }

                // MLS Commit будет обработан для предстоящего перехода
                case VoiceOpcodes.DaveMlsAnnounceCommitTransition: {
                    const { transition_id, success } = this._dave.processMLSTransit("commit", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) {
                            ws.packet = {
                                op: VoiceOpcodes.DaveTransitionReady,
                                d: { transition_id },
                            };
                        }
                    }

                    return;
                }

                // MLS Добро пожаловать в группу для предстоящего перехода
                case VoiceOpcodes.DaveMlsWelcome: {
                    const { transition_id, success } = this._dave.processMLSTransit("welcome", payload);

                    // Если успешно
                    if (success) {
                        if (transition_id !== 0) {
                            ws.packet = {
                                op: VoiceOpcodes.DaveTransitionReady,
                                d: { transition_id },
                            };
                        }
                    }
                }
            }
        });

        // Запускаем заново или впервые
        session.reinit();
    };

    /**
     * @description Метод удаления DAVE/MLS слоя
     * @public
     */
    public destroy = () => {
        this._dave.destroy();
        this._dave = null;
    };
}