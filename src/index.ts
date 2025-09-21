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
    if (isManager) return execute_shardManager();

    // Запускаем осколок
    return execute_shard();
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить менеджер осколков
 * @function execute_shardManager
 * @returns void
 */
function execute_shardManager() {
    Logger.log("WARN", `[Manager] has running ${Logger.color(36, `ShardManager...`)}`);
    new ShardManager(__filename, env.get("token.discord"));
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить осколок
 * @function execute_shard
 * @returns Promise<void>
 * @async
 */
async function execute_shard() {
    Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

    const client = new DiscordClient();
    const id = client.shardID;

    // Инициализируем базу данных
    initDatabase(client);

    // Загружаем API
    await db.api.startWorker();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.api.array.length} APIs`)}`);

    // Загружаем components
    db.components.register();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.components.size} components`)}`);

    // Загружаем middlewares
    db.middlewares.register();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.middlewares.size} middlewares`)}`);


    // Запускаем бота
    await client.login(env.get("token.discord"));


    // Загружаем events
    db.events.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.events.size} events`)}`);

    // Загружаем commands
    db.commands.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.commands.public.length} public, ${db.commands.owner.length} dev commands`)}`);

    // Запускаем отслеживание событий процесса
    init_process_events(client);

    // Запускаем Garbage Collector
    setImmediate(() => {
        if (typeof global.gc === "function") {
            Logger.log("DEBUG", "[Node] running Garbage Collector - running main thread");
            global.gc();
        }
    });
}

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса (ошибки, сигналы)
 * @param client - Класс клиента
 * @function init_process_events
 * @returns void
 */
function init_process_events(client: DiscordClient): void {
    // Необработанная ошибка (внутри синхронного кода)
    process.on("uncaughtException", (err) => {
        // Скорее всего дело в Discord.js
        if (err.stack.match(/ws\/lib\/websocket/gi) || err.stack.match(/APPLICATION_COMMAND_OPTIONS_VALUE_TOO_LARGE/)) return;

        Logger.log("ERROR", err);
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
            if (init_queue_destroyer(client)) return;

            Logger.log("WARN", `Received ${event}. Shutting down...`);
            process.exit(0);
        });
    }
}

/**
 * @author SNIPPIK
 * @description Функция проверяющая состояние очередей, для безопасного выключения
 * @param client - Класс клиента
 * @function init_queue_destroyer
 * @returns boolean
 */
function init_queue_destroyer(client: DiscordClient): boolean {
    if (db.queues.size > 0) {
        // Отключаем все события от клиента, для предотвращения включения или создания еще очередей
        client.removeAllListeners();

        // Время самого долгого трека из всех очередей
        const timeout = db.queues.timeout_reboot;

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