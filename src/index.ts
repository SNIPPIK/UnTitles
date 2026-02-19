import { DiscordClient } from "#structures/discord";
import { initSharedDatabase } from "#worker/db";
import { db, initDatabase } from "#app/db";
import { Logger } from "#structures";

// Точка входа
void main();

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 * @function main
 * @returns void or Promise<void>
 */
function main() {
    // Запускаем осколок
    return runShard();
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить осколок
 * @function runShard
 * @returns Promise<void>
 * @async
 */
async function runShard() {
    Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

    const client = new DiscordClient();

    // Инициализируем базу данных
    initDatabase(client);
    initSharedDatabase();

    // Загружаем API
    await db.api.startWorker();
    client.logger.info(`Loaded ${Logger.color(34, `${db.api.array.length} APIs`)}`);

    // Запускаем бота
    client.start()
        // Что делаем после подключения к discord api
        .finally(async () => {
            await client.uploadCommands({ cachePath: "./commands.json" });

            // Запускаем Garbage Collector
            setImmediate(() => {
                if (typeof global.gc === "function") global.gc();
            });
        });

    // Запускаем отслеживание событий процесса
    initProcessEvents();

    // Тест постоянной нагрузки на event loop
    /*setInterval(() => {
        const startBlock = performance.now();
        while (performance.now() - startBlock < 100) {}
    }, 60);

    setInterval(() => {
        const startBlock = performance.now();
        while (performance.now() - startBlock < 100) {}
    }, 80);

    setInterval(() => {
        const startBlock = performance.now();
        while (performance.now() - startBlock < 100) {}
    }, 120);

    setInterval(() => {
        const startBlock = performance.now();
        while (performance.now() - startBlock < 100) {}
    }, 100);*/

    /*
        // Тест временной нагрузки на event loop
        let size = 1000;
        setInterval(() => {
            if (size === 0) return;
            size--;

            const startBlock = performance.now();
            while (performance.now() - startBlock < 100) {}
        }, 100);*/
}

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса (ошибки, сигналы)
 * @function initProcessEvents
 * @returns void
 */
function initProcessEvents() {
    // Необработанная ошибка (внутри синхронного кода)
    process.on("uncaughtException", (err, origin) => {
        // Скорее всего дело в Discord.js
        if (err.stack.match(/ws\/lib\/websocket/gi)) return;

        Logger.log(
            "ERROR",
            `Uncaught Exception\n` +
            `┌ Name:    ${err.name}\n` +
            `├ Message: ${err.message}\n` +
            `├ Origin:  ${origin}\n` +
            `└ Stack:   ${err.stack}`
        );
    });

    // Необработанный обещание
    process.on("unhandledRejection", (reason) => {
        Logger.log(
            "ERROR",
            `Unhandled Rejection\n` +
            `┌ Reason:  ${reason instanceof Error ? reason.message : String(reason)}\n` +
            `└ Stack:   ${reason instanceof Error ? reason.stack : "N/A"}`
        );
    });

    // Возможность завершить процесс корректно
    for (const event of ["SIGINT", "SIGTERM"]) {
        process.on(event, () => {
            if (ProcessQueues()) return;

            Logger.log("WARN", `Received ${event}. Shutting down...`);
            process.exit(0);
        });
    }
}

/**
 * @author SNIPPIK
 * @description Функция проверяющая состояние очередей, для безопасного выключения
 * @function ProcessQueues
 * @returns void
 */
function ProcessQueues(): boolean {
    if (db.queues.size > 0) {
        // Время самого долгого трека из всех очередей
        const timeout = db.queues.shutdown();

        // Если плееры играют и есть остаток от аудио
        if (timeout > 0) {
            // Ожидаем выключения музыки на других серверах
            setTimeout(() => { process.exit(0); }, timeout + 1e3);

            Logger.log("WARN", `[Queues/${db.queues.size}] Wait other queues. Timeout to restart ${(timeout / 1e3).duration()}`);
            return true;
        }
    }

    return false;
}