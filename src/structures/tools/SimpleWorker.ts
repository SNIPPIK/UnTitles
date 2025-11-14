import { Worker, WorkerOptions } from "node:worker_threads";
import { Logger } from "#structures";
import path from "node:path";

/**
 * @author SNIPPIK
 * @description Класс упрощающий работу с потоками, позволяет за несколько сек запускать и удалять потоки
 * @class SimpleWorker
 * @public
 */
export class SimpleWorker {
    /**
     * @description Создаем или заменяем поток
     * @static
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
     * @static
     * @private
     */
    private static destroy = async (worker: Worker) => {
        worker.removeAllListeners();

        try {
            await worker.terminate();
        } catch (err) {
            Logger.log("ERROR", err as Error);
        }
    };
}


/**
 * @author SNIPPIK
 * @description Интерфейс для работы с потоком
 * @interface WorkerInput
 * @private
 */
interface WorkerInput<T> {
    file: string;
    options: WorkerOptions;
    postMessage: any;
    not_destroyed?: boolean;
    callback(data: T): void;
}