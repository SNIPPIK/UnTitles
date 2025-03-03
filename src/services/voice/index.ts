export * from "./sockets/SocketUDP";
export * from "./sockets/VoiceSocket";
export * from "./sockets/Connection";

// Audio
export * from "./audio/resource";
export * from "./audio/process";

// Decoder and encoders
export * from "./audio/sodium";
export * from "./audio/opus";

import type {VoiceSocketState} from "./sockets/VoiceSocket";
import type {CloseEvent} from "ws";

/**
 * @author SNIPPIK
 * @description Различные коды состояния, которые может содержать голосовое соединение в любой момент времени
 * @enum VoiceConnectionStatus
 */
export enum VoiceConnectionStatus {
    /**
     * @description Пакеты `VOICE_SERVER_UPDATE` и `VOICE_STATE_UPDATE` были получены, теперь предпринимается попытка установить голосовое соединение.
     */
    Connecting = "connecting",

    /**
     * @description Голосовое соединение было разрушено и не отслеживалось, его нельзя использовать повторно.
     */
    Destroyed = "destroyed",

    /**
     * @description Голосовое соединение либо разорвано, либо не установлено.
     */
    Disconnected = "disconnected",

    /**
     * @description Голосовое соединение установлено и готово к использованию.
     */
    Ready = "ready",

    /**
     * @description Отправляем пакет на главный шлюз Discord, чтобы указать, что мы хотим изменить наше голосовое состояние.
     */
    Signalling = "signalling",
}

/**
 * @author SNIPPIK
 * @description События для VoiceWebSocket
 * @interface WebSocketEvents
 */
export interface WebSocketEvents {
    /**
     * @description Событие при котором сокет получает ошибку
     * @param error - Ошибка
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет открывает соединение
     * @param event - Класс ответа
     */
    readonly "open": (event: Event) => void;

    /**
     * @description Событие при котором сокет закрывает соединение
     * @param event - Класс ответа
     */
    readonly "close": (event: CloseEvent) => void;

    /**
     * @description Событие при котором сокет получает ответ от соединения
     * @param packet - Полученный пакет
     */
    readonly "packet": (packet: any) => void;
}

/**
 * @author SNIPPIK
 * @description События для VoiceSocket
 * @interface VoiceSocketEvents
 */
export interface VoiceSocketEvents {
    /**
     * @description Событие при котором сокет меняет внутреннее состояние
     * @param oldState - Старое состояние
     * @param newState - Новое состояние
     */
    readonly "stateChange": (oldState: VoiceSocketState.States, newState: VoiceSocketState.States) => void;

    /**
     * @description Событие при котором сокет получает ошибку
     * @param error - Ошибка
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет закрывается
     */
    readonly "close": (code: number) => void;
}

/**
 * @author SNIPPIK
 * @description События для UDP
 * @interface UDPSocketEvents
 */
export interface UDPSocketEvents {
    /**
     * @description Событие при котором сокет получает ответ от сервера
     * @param message - Само сообщение
     */
    readonly "message": (message: Buffer) => void;

    /**
     * @description Событие при котором сокет получает ошибку
     * @param error - Ошибка
     */
    readonly "error": (error: Error) => void;

    /**
     * @description Событие при котором сокет закрывается
     */
    readonly "close": () => void;

    /**
     * @description Событие при котором будет возращены данные для подключения
     */
    readonly "connected": (info: { ip: string; port: number; }) => void;
}