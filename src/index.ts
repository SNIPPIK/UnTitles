import {Client, ShardManager} from "@lib/discord";
import process from "node:process";
import {Logger} from "@lib/logger";
import {Colors} from "discord.js";
import {db} from "@lib/db";
import {env} from "@env";

/**
 * @name ShardManager
 * @description Загрузка менеджера осколков
 */
if (process["argv"].includes("--ShardManager")) {
    Logger.log("LOG", `[ShardManager] is started`);
    new ShardManager(__filename);
}

/**
 * @name "shard"
 * @description Загрузка осколка
 */
else {
    const client = new Client();
    Logger.log("LOG", `[Shard ${client.ID}] is started`);

    /**
     * @description Подключаемся к api discord
     */
    client.login(env.get("token.discord")).then(() => {
        // Запускаем загрузку модулей после инициализации бота
        client.once("ready", () => {
            Logger.log("LOG", `[Shard ${client.ID}] is connected to websocket`);
            db.initialize = client;
        });
    });

    /**
     * @description Удаляем копию клиента если процесс был закрыт
     */
    for (const event of ["exit"]) process.once(event, () => {
        Logger.log("DEBUG", "[Process] is killed!");
        client.destroy().catch((err) => Logger.log("ERROR", err));
        process.exit(0);
    });

    /**
     * @description Ловим попытки сломать процесс
     */
    process.on("uncaughtException", (err: Error) => {
        // Отправляем данные об ошибке и отправляем через систему webhook
        client.sendWebhook = {
            username: client.user.username, avatarURL: client.user.avatarURL(),
            embeds: [{
                title: "uncaughtException",
                description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                fields: [{
                    name: "Stack:",
                    value: `\`\`\`${err.stack}\`\`\``
                }],
                color: Colors.DarkRed,
            }],
        }

        // Если получена критическая ошибка, из-за которой будет нарушено выполнение кода
        if (err.message?.match(/Critical/)) {
            Logger.log("ERROR", `[CODE: <14>] Hooked critical error!`);
            process.exit(14);
            //return;
        }

        // Если вдруг запущено несколько ботов
        else if (err.name?.match(/acknowledged./)) return Logger.log("WARN", `[CODE: <50490>] Several bots are running!`);

        //Выводим ошибку
        Logger.log("ERROR", `\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n└ Stack:   ${err.stack}`);
    });
    process.on("unhandledRejection", (err: Error) => {
        //if (`${err}`.match(/DiscordAPIError/)) return;
        console.log(err);
    });
}