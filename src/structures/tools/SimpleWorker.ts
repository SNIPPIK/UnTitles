import { TypedEmitter } from "#structures/tools/TypedEmitter.js";
import { Worker, WorkerOptions } from "node:worker_threads";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description События, которые может генерировать SimpleWorker
 * @interface WorkerEvents
 * @public
 */
interface WorkerEvents<TOutput = any> {
    /** @description Получено сообщение от воркера */
    message: (data: TOutput) => void;

    /** @description Ошибка в воркере */
    error: (error: Error) => void;

    /** @description Воркер завершил выполнение */
    exit: (code: number) => void;
}

/**
 * @author SNIPPIK
 * @description Улучшенный класс для работы с Worker Threads с автоматическим управлением жизненным циклом,
 *              типизированными событиями и поддержкой TypedEmitter.
 * @template TInput - Тип данных, отправляемых в воркер
 * @template TOutput - Тип данных, получаемых от воркера
 * @class SimpleWorker
 * @extends TypedEmitter<WorkerEvents<TOutput>>
 * @public
 */
export class SimpleWorker<TInput = any, TOutput = any> extends TypedEmitter<WorkerEvents<TOutput>> {
    private logger: Console | { log: (level: string, ...args: any[]) => void };
    private readonly autoDestroy: boolean;
    private worker: Worker | null = null;

    /**
     * @description Конструктор SimpleWorker
     * @param file - Путь к файлу воркера (абсолютный или относительный)
     * @param options - Опции для Worker (WorkerOptions)
     * @param autoDestroy - Уничтожать воркер после первого полученного сообщения
     * @param logger - Логгер для ошибок (по умолчанию console)
     * @public
     */
    public constructor(
        private file: string,
        private options: WorkerOptions = {},
        autoDestroy = true,
        logger: { log: (level: any, ...args: any[]) => void } = console
    ) {
        super();
        this.autoDestroy = autoDestroy;
        this.logger = logger;
    };

    /**
     * @description Запускает воркер и отправляет начальные данные (если указаны)
     * @param initialData - Данные, которые будут отправлены в воркер сразу после запуска
     * @returns Promise<void>
     * @throws {Error} Если воркер уже запущен
     * @public
     */
    public async start(initialData?: TInput): Promise<void> {
        if (this.worker) throw new Error("Worker already started");

        const workerPath = path.isAbsolute(this.file) ? this.file : path.resolve(this.file);
        this.worker = new Worker(workerPath, this.options);

        // Обработчики событий (без автоматического удаления)
        this.worker.on("message", (data: TOutput) => {
            this.emit("message", data);
            if (this.autoDestroy) this.destroy();
        });

        // Обработчик ошибок
        this.worker.on("error", (err) => {
            //@ts-ignore
            this.emit("error", err);
            if (this.autoDestroy) this.destroy();
        });

        // Обработчик выхода процесса
        this.worker.on("exit", (code) => {
            this.emit("exit", code);
            if (this.autoDestroy) this.destroy();
        });

        if (initialData !== undefined) {
            this.send(initialData);
        }
    };

    /**
     * @description Отправляет данные в работающий воркер
     * @param data - Данные для отправки
     * @throws {Error} Если воркер не запущен
     * @public
     */
    public send(data: TInput): void {
        if (!this.worker) throw new Error("Worker not started");
        this.worker.postMessage(data);
    };

    /**
     * @description Принудительно завершает воркер и очищает ресурсы
     * @returns Promise<void>
     * @public
     */
    public async destroy(): Promise<void> {
        if (!this.worker) return;
        this.worker.removeAllListeners();
        try {
            await this.worker.terminate();
        } catch (err) {
            this.logger.log("ERROR", err);
            throw err;
        } finally {
            this.worker = null;
        }
    };
}