/**
 * @author SNIPPIK
 * @description Высокопроизводительные нативные привязки Rust для работы с медиа-потоками и сетью.
 */

/**
 * @description Метка времени в микросекундах (1 мс = 1000 мкс).
 * Используется для сверхточной синхронизации аудио-фреймов.
 */
export type Microseconds = number;

/**
 * @interface OggOpusParser
 * @description Экземпляр нативного парсера OGG/Opus.
 */
export interface OggOpusParser {
    /**
     * @description Разбирает входящий поток байт на составляющие Opus-пакеты.
     * @param chunk {Buffer} - Сырой буфер данных (например, кусок файла или поток из FFmpeg).
     * @param callback {Function} - Обратный вызов, срабатывающий при обнаружении данных.
     * @param callback.type {'header' | 'metadata' | 'frame'} - Тип найденного пакета.
     * @param callback.data {Buffer} - Содержимое пакета.
     */
    parse(chunk: Buffer, callback: (type: 'header' | 'metadata' | 'frame', data: Buffer) => void): void;
}

/**
 * @interface FfmpegProcess
 * @description Управляемый процесс FFmpeg, запущенный в нативном слое.
 */
export interface FfmpegProcess {
    /**
     * @description Начинает чтение stdout процесса FFmpeg и передает чанки в JS.
     * @param callback {Function} - Функция, принимающая Buffer с данными из stdout.
     * @param callback.chunk {Buffer} - Порция данных от FFmpeg.
     */
    pipeStdout(callback: (chunk: Buffer) => void): void;

    /**
     * @description Принудительно завершает процесс (SIGKILL) и освобождает ресурсы.
     */
    destroy(): void;
}

/**
 * @interface AudioEngine
 * @description Нативный менеджер очереди пакетов (Jitter Buffer / Очередь).
 */
export interface AudioEngine {
    /**
     * @description Добавляет готовый пакет Opus в конец внутренней очереди.
     * @param packet {Buffer} - Фрейм аудио-данных.
     */
    addPacket(packet: Buffer): void;

    /**
     * @description [Режим Стриминга] Извлекает первый пакет из очереди и удаляет его (FIFO).
     * @returns {Buffer | null} - Пакет или null, если очередь пуста.
     */
    readonly consumePacket: Buffer | null;

    /**
     * @description [Режим Буфера] Возвращает пакет по текущему индексу position без удаления.
     * @returns {Buffer | null} - Пакет или null.
     */
    readonly packet: Buffer | null;

    /**
     * @description Возвращает общее количество пакетов, хранящихся в памяти.
     * @returns {number}
     */
    readonly size: number;

    /**
     * @description Текущий индекс чтения для режима буферизации (Buffered).
     * @param value {number} - Новая позиция (индекс пакета).
     */
    position: number;

    /**
     * @description Очищает все накопленные пакеты и сбрасывает позицию.
     */
    clear(): void;
}

/**
 * @interface UdpSender
 * @description Нативный UDP-клиент для высокоскоростной отправки данных в Discord.
 */
export interface UdpSender {
    /**
     * @description Отправляет UDP-пакет напрямую по адресу назначения.
     * @param packet {Buffer} - Полностью сформированный пакет (RTP + Encrypted Opus).
     */
    sendPacket(packet: Buffer): void;

    /**
     * @description Запускает фоновый поток прослушивания входящих UDP-пакетов.
     * @param callback {Function} - Обработка входящих данных (например, IP Discovery).
     * @param callback.message {Buffer} - Входящий пакет данных.
     */
    startListening(callback: (message: Buffer) => void): void;
}

/** Загрузка бинарного модуля */
const NativeRust = require('../../native/index.js');

/**
 * @description Конструктор парсера OGG/Opus.
 * @example const parser = new OggOpusParser();
 */
export const OggOpusParser: new () => OggOpusParser = NativeRust.OggOpusParser;

/**
 * @description Конструктор процесса FFmpeg.
 * @param args {string[]} - Аргументы командной строки (например, ["-i", "url", ...]).
 * @param name {string} - Путь к бинарнику или команда 'ffmpeg'.
 */
export const FfmpegProcess: new (args: string[], name: string) => FfmpegProcess = NativeRust.FfmpegProcess;

/**
 * @description Конструктор движка управления аудио-пакетами.
 * @param maxMinutes {number} - Максимальная длительность буфера в минутах (0 для Pipe/Streaming режима).
 */
export const AudioEngine: new (maxMinutes: number) => AudioEngine = NativeRust.AudioEngine;

/**
 * @description Конструктор UDP-клиента.
 * @param remoteAddr {string} - Строка адреса в формате "IP:PORT".
 */
export const UdpSender: new (remoteAddr: string) => UdpSender = NativeRust.UdpSender;

/**
 * @description Пытается найти FFmpeg в системе.
 * @param customPaths {string[]} - Дополнительные пути для поиска.
 * @returns {string | null} - Путь к FFmpeg или null, если не найден.
 */
export const findFfmpeg: (customPaths: string[]) => string | null = NativeRust.findFfmpeg;

/**
 * @description Запускает нативный высокоточный цикл (воркер).
 * @param interval {number} - Интервал тика в миллисекундах (например, 20).
 * @param callback {Function} - Функция, вызываемая на каждом шаге.
 * @param callback.timestamp {Microseconds} - Точное время выстрела таймера в мкс.
 * @returns {number} - Уникальный ID воркера.
 */
export const startCycle: (interval: number, callback: (timestamp: Microseconds) => void) => number = NativeRust.startCycle;

/**
 * @description Останавливает работу воркера и удаляет поток.
 * @param id {number} - ID воркера, полученный при старте.
 */
export const stopCycle: (id: number) => void = NativeRust.stopCycle;

/**
 * @description Устанавливает коррекцию времени для воркера.
 * @param id {number} - ID воркера.
 * @param lagMicroseconds {Microseconds} - Задержка в микросекундах для компенсации.
 */
export const setLag: (id: number, lagMicroseconds: Microseconds) => void = NativeRust.setLag;

/**
 * @description Меняет множитель интервала шага (скорость цикла).
 * @param id {number} - ID воркера.
 * @param multiplier {number} - Коэффициент скорости (1.0 = норма).
 */
export const setStepInterval: (id: number, multiplier: number) => void = NativeRust.setStepInterval;

/** Экспорт по умолчанию для доступа через NativeRust */
export default NativeRust;