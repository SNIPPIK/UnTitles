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
 * Обёртка над Node.js Worker Threads с автоматическим управлением жизненным циклом,
 * типизированными событиями и поддержкой `TypedEmitter`.
 *
 * Предоставляет простой API для запуска, отправки данных и остановки воркера,
 * а также опциональный режим автоматического уничтожения после первого события.
 *
 * @typeParam TInput - Тип данных, отправляемых в воркер через `postMessage`.
 * @typeParam TOutput - Тип данных, получаемых от воркера (событие `"message"`).
 *
 * @example
 * ```ts
 * const worker = new SimpleWorker<string, string>('./my-worker.ts');
 * worker.on('message', (msg) => console.log(msg));
 * worker.start('initial data');
 * worker.send('another message');
 * await worker.destroy();
 * ```
 */
export class SimpleWorker<TInput = any, TOutput = any> extends TypedEmitter<WorkerEvents<TOutput>> {
    /**
     * Экземпляр воркера.
     * `null`, если воркер ещё не запущен или уже уничтожен.
     */
    private worker: Worker | null = null;

    /**
     * Абсолютный путь к файлу воркера.
     */
    private readonly workerPath: string;

    /**
     * Режим автоматического уничтожения после первого события
     * (`"message"` или `"error"`).
     */
    private readonly autoDestroy: boolean;

    /**
     * @param file        - Путь к файлу воркера (абсолютный или относительный).
     * @param options     - Стандартные опции `WorkerOptions` (передаются в конструктор `Worker`).
     * @param autoDestroy - Если `true`, воркер автоматически уничтожается после первого
     *                      события `"message"` или `"error"`.
     * @param logger      - Объект с методом `log(level, ...args)` для логирования ошибок
     *                      (по умолчанию `console`).
     */
    public constructor(
        file: string,
        private options: WorkerOptions = {},
        autoDestroy = false,
        private logger: { log: (level: any, ...args: any[]) => void } = console
    ) {
        super();

        // Приводим путь к абсолютному, если он ещё не абсолютный.
        this.workerPath = path.isAbsolute(file)
            ? file
            : path.resolve(file);

        this.autoDestroy = autoDestroy;
    };

    /**
     * Запускает воркер и опционально отправляет начальные данные.
     *
     * Подписывается на события `"message"`, `"error"` и `"exit"`,
     * пробрасывая их через `TypedEmitter`. При получении `"exit"` сбрасывает
     * ссылку на воркер в `null`.
     *
     * В режиме `autoDestroy` после **первого** события `"message"` или `"error"`
     * воркер будет автоматически уничтожен.
     *
     * @param initialData - Данные, отправляемые в воркер сразу после запуска.
     *                      Если `undefined`, ничего не отправляется.
     *
     * @throws {Error} Если воркер уже запущен (повторный вызов запрещён).
     */
    public start(initialData?: TInput): void {
        if (this.worker) throw new Error("Worker already started");

        const worker = new Worker(this.workerPath, this.options);
        this.worker = worker;

        // ===== Проброс события "message" =====
        worker.on("message", (data: TOutput) => {
            this.emit("message", data);
        });

        // ===== Проброс события "error" =====
        worker.on("error", (err) => {
            //@ts-ignore
            this.emit("error", err);
        });

        // ===== Проброс события "exit" и очистка ссылки =====
        worker.on("exit", (code) => {
            this.emit("exit", code);
            this.worker = null;
        });

        // Отправляем начальные данные, если они заданы.
        if (initialData !== undefined) {
            worker.postMessage(initialData);
        }

        // Режим автоматического уничтожения после первого события.
        if (this.autoDestroy) {
            const onceHandler = () => {
                this.destroy();
            };
            worker.once("message", onceHandler);
            worker.once("error", onceHandler);
        }
    };

    /**
     * Отправляет данные в запущенный воркер.
     *
     * @param data - Данные для отправки через `worker.postMessage`.
     *
     * @throws {Error} Если воркер не запущен.
     */
    public send(data: TInput): void {
        const worker = this.worker;
        if (!worker) throw new Error("Worker not started");
        worker.postMessage(data);
    };

    /**
     * Асинхронно завершает воркер.
     *
     * Удаляет всех слушателей событий и вызывает `worker.terminate()`.
     * Ссылка на воркер обнуляется **синхронно**, чтобы предотвратить
     * повторные попытки использования во время асинхронного завершения.
     *
     * Безопасно вызывать повторно: если воркер уже уничтожен,
     * метод сразу возвращается.
     *
     * @returns Promise, который разрешается после вызова `worker.terminate()`.
     */
    public async destroy(): Promise<void> {
        const worker = this.worker;
        if (!worker) return;

        // Обнуляем ссылку синхронно, чтобы избежать повторного входа.
        this.worker = null;

        // Снимаем все подписки, чтобы не получить утекшие обработчики.
        worker.removeAllListeners();

        try {
            await worker.terminate();
        } catch (err) {
            this.logger.log("ERROR", err);
        }
    };
}