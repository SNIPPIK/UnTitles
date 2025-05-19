import { DiscordClient, ShardManager } from "@structures";
import { isMainThread } from "node:worker_threads";
import { Logger } from "@utils";
import { env } from "@app/env";
import { db} from "@app/db";

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 */
(() => {
    // Если при запуске многопоточных элементов произойдет случайный запуск осколка
    if (!isMainThread) throw new Error("Not implemented.");

    // Проверяем на наличие аргумента запуска менеджера осколков
    switch (process["argv"].includes("--ShardManager")) {
        /**
         * @author SNIPPIK
         * @description Если требуется запустить менеджер осколков
         */
        case true: {
            Logger.log("WARN", `[Manager] has running ${Logger.color(36, `ShardManager...`)}`);
            // Создаем менеджер осколков
            new ShardManager(__filename, env.get("token.discord"));
            return;
        }

        /**
         * @author SNIPPIK
         * @description Если требуется запустить осколок
         */
        default: {
            Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

            // Создаем класс осколка
            const client = new DiscordClient();
            const id = client.shardID;

            // Подключаем осколок к discord
            client.login(env.get("token.discord"))
                // Что делаем после подключения к discord api
                .finally(async () => {
                    // Загруженные кнопки
                    db.buttons.register();
                    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.buttons.size} buttons`)}`);

                    // Загружаем платформы
                    await db.api.startWorker();
                    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.api.allow} APIs`)}`);

                    // Загружаем события
                    db.events.register(client);
                    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.events.size} events`)}`);

                    // Загружаем команды
                    db.commands.register(client);
                    Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.commands.public.length} public, ${db.commands.owner.length} dev commands`)}`);
                });

            // Создаем webhook клиент
            return initProcessEvents();
        }
    }
})();

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса
 */
function initProcessEvents() {
    // Отлавливаем все ошибки внутри процесса
    process.on("uncaughtException", (err, origin) => {
        //Выводим ошибку
        Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);
    });
}