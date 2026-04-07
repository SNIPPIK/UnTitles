import { DiscordClient } from "#structures/discord";
import { initSharedDatabase } from "#worker/db";
import { db, initDatabase } from "#app/db";
import { Logger } from "#structures";

// Точка входа с обработкой ошибок
main().catch((error) => {
    Logger.log("ERROR", `Failed to start application: ${error.stack || error}`);
    process.exit(1);
});

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 * @returns {Promise<void>}
 * @async
 */
async function main(): Promise<void> {
    await runShard();
}

/**
 * @author SNIPPIK
 * @description Запуск основного шарда (экземпляра бота)
 * @returns {Promise<void>}
 * @async
 */
async function runShard(): Promise<void> {
    Logger.log("WARN", `[Core] has running ${Logger.color(36, "shard")}`);

    const client = new DiscordClient();

    try {
        // Инициализация баз данных
        initDatabase(client);
        initSharedDatabase();

        // Загрузка API-модулей
        await db.api.startWorker();
        client.logger.info(`Loaded ${Logger.color(34, `${db.api.map.size} APIs`)}`);

        // Запуск Discord клиента с последующей пост-инициализацией
        await client.start();

        // Загрузка команд после успешного подключения
        await client.uploadCommands({ cachePath: "./commands.json" }).catch((err) => {
            client.logger.error(`Failed to upload commands: ${err.message}`);
        });

        // Опциональный вызов GC (только при явном флаге или в dev-режиме)
        if (process.env.FORCE_GC === "true" && typeof global.gc === "function") {
            setImmediate(() => global.gc());
            client.logger.debug("Garbage collector triggered");
        }
    } catch (error) {
        Logger.log("ERROR", `Failed to initialize shard: ${error["stack"] || error}`);
        throw error; // Пробрасываем для обработки в main
    }

    // Отслеживание событий процесса (сигналы, ошибки)
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
 * @description Инициализация глобальных обработчиков процесса
 * @function initProcessEvents
 */
function initProcessEvents(): void {
    // Необработанное синхронное исключение
    process.on("uncaughtException", (err, origin) => {
        // Игнорируем известные проблемы WebSocket (Discord.js)
        if (isWebSocketError(err)) {
            Logger.log("DEBUG", `Ignored WebSocket error: ${err.message}`);
            return;
        }

        Logger.log(
            "ERROR",
            `Uncaught Exception\n` +
            `┌ Name:    ${err.name}\n` +
            `├ Message: ${err.message}\n` +
            `├ Origin:  ${origin}\n` +
            `└ Stack:   ${err.stack || "N/A"}`
        );
    });

    // Необработанное отклонение промиса
    process.on("unhandledRejection", (reason, promise) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        Logger.log(
            "ERROR",
            `Unhandled Rejection\n` +
            `┌ Reason:  ${error.message}\n` +
            `├ Promise: ${promise}\n` +
            `└ Stack:   ${error.stack || "N/A"}`
        );
    });

    // Корректное завершение по сигналам
    const shutdownSignals: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];
    for (const signal of shutdownSignals) {
        process.on(signal, () => {
            Logger.log("WARN", `Received ${signal}. Initiating graceful shutdown...`);
            return gracefulShutdown();
        });
    }
}

/**
 * @description Проверяет, является ли ошибка внутренней проблемой WebSocket Discord.js
 * @param err - Ошибка
 * @returns true если это известная ошибка WebSocket
 */
function isWebSocketError(err: Error): boolean {
    // Проверка по имени или сообщению, а не по хрупкому регулярному выражению
    return err.name === "WebSocketError" ||
        err.message?.includes("WebSocket") ||
        err.stack?.includes("ws/lib/websocket") === true;
}

/**
 * @description Graceful shutdown: ожидание завершения активных очередей и выход
 * @async
 */
async function gracefulShutdown(): Promise<void> {
    // Проверяем наличие активных музыкальных очередей
    const hasQueues = db.queues && db.queues.size > 0;
    if (hasQueues) {
        const maxTimeout = db.queues.shutdown(); // время до конца самого длинного трека
        if (maxTimeout > 0) {
            Logger.log(
                "WARN",
                `[Queues/${db.queues.size}] Waiting for queues to finish. ` +
                `Max delay: ${(maxTimeout / 1000).toFixed(1)}s`
            );
            await new Promise((resolve) => setTimeout(resolve, maxTimeout + 1000));
        }
    }

    // Закрытие соединений с базами данных (если есть метод close)
    //if (db.close) await db.close().catch((e) => Logger.error("DB close error", e));
    //if (db.api?.close) await db.api.close().catch((e) => Logger.error("API close error", e));

    Logger.log("WARN", "Shutdown complete. Exiting.");
    process.exit(0);
}