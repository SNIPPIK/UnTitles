import { DiscordClient, ShardManager } from "#structures/discord";
import { db, initDatabase } from "#app/db";
import { Logger } from "#structures";
import { env } from "#app/env";

// Точка входа
void main();

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 * @function main
 * @returns void or Promise<void>
 */
function main() {
    const isManager = process.argv.includes("--ShardManager");

    // Если включен менеджер осколков
    if (isManager) return runShardManager();

    // Запускаем осколок
    return runShard();
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить менеджер осколков
 * @function runShardManager
 * @returns void
 */
function runShardManager() {
    Logger.log("WARN", `[Manager] has running ${Logger.color(36, `ShardManager...`)}`);
    new ShardManager(__filename, env.get("token.discord"));
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
    const id = client.shardID;

    // Инициализируем базу данных
    initDatabase(client);

    // Запускаем бота
    await client.login(env.get("token.discord"));

    // Загружаем components
    db.components.register();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.components.size} components`)}`);

    // Загружаем API
    await db.api.startWorker();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.api.allow.length} APIs`)}`);

    // Загружаем middlewares
    db.middlewares.register();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.middlewares.size} middlewares`)}`);

    // Загружаем events
    db.events.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.events.size} events`)}`);

    // Загружаем commands
    db.commands.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.commands.public.length} public, ${db.commands.owner.length} dev commands`)}`);

    // Запускаем отслеживание событий процесса
    initProcessEvents(client);

    // Запускаем Garbage Collector
    setImmediate(() => {
        if (typeof global.gc === "function") global.gc();
    });

    // Искусственная нагрузка, если вы видите это, значит хватит сюда смотреть 0_0
    /*
    setInterval(() => {
        const startBlock = performance.now();
        while (performance.now() - startBlock < 100) {} // Блокируем Event Loop
    }, 200);
     */
}

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса (ошибки, сигналы)
 * @param client - Класс клиента
 * @function initProcessEvents
 * @returns void
 */
function initProcessEvents(client: DiscordClient) {
    // Необработанная ошибка (внутри синхронного кода)
    process.on("uncaughtException", (err, origin) => {
        // Скорее всего дело в Discord.js
        if (err.name.match(/node_modules\/ws\/lib\/websocket/)) return;

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
            if (ProcessQueues(client)) return;

            Logger.log("WARN", `Received ${event}. Shutting down...`);
            process.exit(0);
        });
    }
}

/**
 * @author SNIPPIK
 * @description Функция проверяющая состояние очередей, для безопасного выключения
 * @param client - Класс клиента
 * @function ProcessQueues
 * @returns void
 */
function ProcessQueues(client: DiscordClient): boolean {
    if (db.queues.size > 0) {
        // Отключаем все события от клиента, для предотвращения включения или создания еще очередей
        client.removeAllListeners();

        // Время самого долгого трека из всех очередей
        const timeout = db.queues.timeout_reboot;

        // Если плееры играют и есть остаток от аудио
        if (timeout) {
            // Ожидаем выключения музыки на других серверах
            setTimeout(() => { process.exit(0); }, timeout + 1e3);

            Logger.log("WARN", `[Queues/${db.queues.size}] Wait other queues. Timeout to restart ${(timeout / 1e3).duration()}`);
            return true;
        }
    }

    return false;
}