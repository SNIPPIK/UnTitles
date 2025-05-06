import { DiscordClient, ShardManager } from "@structures";
import { Colors, WebhookClient } from "discord.js";
import { isMainThread } from "node:worker_threads";
import { db, initDatabase } from "@app/db";
import { Logger } from "@utils";
import { env } from "@app/env";

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
            initDatabase();

            Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

            // Создаем класс осколка
            const client = initClient();

            // Создаем webhook клиент
            return initProcessEvents(client);
        }
    }
})();

/**
 * @author SNIPPIK
 * @description Инициализирует осколок
 * @private
 */
function initClient() {
    // Создаем класс осколка
    const client = new DiscordClient();
    const id = client.shardID;

    // Подключаем осколок к discord
    client.login(env.get("token.discord"))
        // Что делаем после подключения к discord api
        .finally(() => {
            // Загруженные кнопки
            db.buttons.register();
            Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.buttons.size} buttons`)}`);

            // Загружаем платформы
            db.api.register();
            Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.api.platforms.supported.length} APIs Supported, ${db.api.platforms.authorization.length} APIs Unauthorized`)}`);

            // Загружаем события
            db.events.register(client);
            Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.events.events.length} events`)}`);

            // Загружаем команды
            db.commands.register(client);
            Logger.log("LOG", `[Core/${id}] Loaded ${Logger.color(34, `${db.commands.public.length} public, ${db.commands.owner.length} dev commands`)}`);
        });

    return client;
}

/**
 * @author SNIPPIK
 * @description Инициализирует события процесса
 * @param client - Запущенный осколок
 */
function initProcessEvents(client: DiscordClient) {
    // Создаем webhook клиент
    const webhookToken = env.get<string>("webhook.token", null);
    const webhookID = env.get("webhook.id", null);
    const webhook = webhookID && webhookToken ? new WebhookClient({ id: webhookID, token: webhookToken }) : null;

    // Отлавливаем все ошибки внутри процесса
    process.on("uncaughtException", (err, origin) => {
        //Выводим ошибку
        Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);

        // Отправляем данные об ошибке и отправляем через систему webhook
        if (webhook) {
            webhook.send({
                username: client.user.username,
                avatarURL: client.user.avatarURL(),
                embeds: [{
                    color: Colors.DarkRed,
                    title: "Caught exception",
                    description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                    fields: [
                        {
                            name: "Stack:",
                            value: `\`\`\`${err.stack}\`\`\``
                        }
                    ]
                }]
            }).catch(() => {
                Logger.log("ERROR", "[Webhook] Fail send message");
            });
        }
    });
}