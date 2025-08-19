import { Worker, WorkerOptions } from "node:worker_threads";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Класс упрощающий работу с потоками
 */
export class SimpleWorker {
    /**
     * @description Создаем или заменяем поток
     * @public
     */
    public static create<T>({options, file, callback, postMessage, not_destroyed}: WorkerInput<T>): Worker {
        const worker = new Worker(path.resolve(file), options);

        // Отправляем данные
        worker.postMessage(postMessage);

        // События для упрощенного удаления
        worker.once("error", () => this.destroy(worker));
        worker.once("exit", () => this.destroy(worker));

        // Отвечаем на получение данных
        worker.once("message", (message) => {
            callback(message);

            // Удалям путь файла
            delete require.cache[require.resolve(file)];

            // Если поток должен остаться активным
            if (!not_destroyed) this.destroy(worker);
        });

        return worker;
    };

    /**
     * @description Уничтожаем поток
     * @param worker - Поток
     * @private
     */
    private static destroy = async (worker: Worker) => {
        worker.removeAllListeners();
        worker.ref(); // Привязываем к main, что-бы GC понял что это надо удалить

        try {
            await worker.terminate();
        } catch (err) {
            console.error("Worker terminate failed", err);
        }
    };
}


/**
 * @author SNIPPIK
 * @description Интерфейс для работы с потоком
 * @interface WorkerInput
 */
interface WorkerInput<T> {
    file: string;
    options: WorkerOptions;
    postMessage: any;
    not_destroyed?: boolean;
    callback(data: T): void;
}