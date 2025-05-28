import { DiscordClient, ShardManager } from "#structures";
import { isMainThread } from "node:worker_threads";
import { db, initDatabase } from "#app/db";
import { Logger } from "#utils";
import { env } from "#app/env";

// Точка входа
void main();

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 */
async function main() {
    if (!isMainThread) throw new Error("Not implemented.");

    const isManager = process.argv.includes("--ShardManager");

    if (isManager) return runShardManager();
    else return runShard();
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить менеджер осколков
 */
function runShardManager() {
    Logger.log("WARN", `[Manager] has running ${Logger.color(36, `ShardManager...`)}`);
    new ShardManager(__filename, env.get("token.discord"));
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить осколок
 */
async function runShard() {
    Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

    const client = new DiscordClient();
    const id = client.shardID;

    initDatabase(client);

    await client.login(env.get("token.discord"));

    // Регистрируем всё остальное
    db.buttons.register();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.buttons.size} buttons`)}`);

    await db.api.startWorker();
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.api.allow.length} APIs`)}`);

    db.events.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.events.size} events`)}`);

    db.commands.register(client);
    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.commands.public.length} public, ${db.commands.owner.length} dev commands`)}`);

    initProcessEvents();
}

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса (ошибки, сигналы)
 */
export function initProcessEvents() {
    // Необработанная ошибка (внутри синхронного кода)
    process.on("uncaughtException", (err, origin) => {
        Logger.log(
            "ERROR",
            `Uncaught Exception\n` +
            `┌ Name:    ${err.name}\n` +
            `├ Message: ${err.message}\n` +
            `├ Origin:  ${origin}\n` +
            `└ Stack:   ${err.stack}`
        );
    });

    // Необработанный промис
    process.on("unhandledRejection", (reason: any) => {
        Logger.log(
            "ERROR",
            `Unhandled Rejection\n` +
            `┌ Reason:  ${reason instanceof Error ? reason.message : String(reason)}\n` +
            `└ Stack:   ${reason instanceof Error ? reason.stack : "N/A"}`
        );
    });

    // Возможность завершить процесс корректно
    process.on("SIGINT", () => {
        Logger.log("WARN", "Received SIGINT. Shutting down...");
        process.exit(0);
    });

    process.on("SIGTERM", () => {
        Logger.log("WARN", "Received SIGTERM. Shutting down...");
        process.exit(0);
    });
}