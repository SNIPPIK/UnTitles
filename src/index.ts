import {IntentsBitField, Partials, Colors} from "discord.js";
import {Client, ShardManager} from "@service/discord";
import {Logger} from "@service/logger";
import process from "node:process";
import {db} from "@service/db";
import {env} from "@env";

/**
 * @name ShardManager
 * @description Загрузка менеджера осколков
 */
if (process["argv"].includes("--ShardManager")) {
    Logger.log("LOG", `[ShardManager] is starting...`);
    new ShardManager(__filename, {
        token: env.get("token.discord"),
        mode: "process",
        totalShards: env.get("shard.total"),
        execArgv: ["-r", "tsconfig-paths/register"],
        respawn: true
    });
}

/**
 * @name Client
 * @description Загрузка осколка
 */
else {
    const client = new Client({
        // Какие данные не надо кешировать (для экономии памяти)
        allowedMentions: {
            parse: ["roles", "users"],
            repliedUser: true,
        },

        // Права бота
        intents: [
            IntentsBitField.Flags.GuildExpressions,
            IntentsBitField.Flags.GuildIntegrations,
            IntentsBitField.Flags.GuildVoiceStates,
            IntentsBitField.Flags.Guilds
        ],

        // Данные которые обязательно надо кешировать
        partials: [
            Partials.Channel,
            Partials.GuildMember,
            Partials.Message,
            Partials.Reaction,
            Partials.User
        ]
    });
    Logger.log("LOG", `[Shard ${client.ID}] is loading...`);

    /**
     * @description Подключаемся к api discord
     */
    client.login(env.get("token.discord")).then(() => {
        // Запускаем загрузку модулей после инициализации бота
        db.initialize = client;
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
     * @description Событие генерируется, когда не перехваченный JavaScript исключений возвращается в цикл событий
     * @link https://nodejs.org/api/process.html#event-uncaughtexception
     */
    process.on("uncaughtException", (err, origin) => {
        if (err.message.match(/read ECONNRESET/)) return Logger.log("WARN", `[ECONNRESET] WebSocket ECONNRESET`);
        else if (err.message.match(/Unknown interaction/)) return Logger.log("WARN", `[Hocked Error Discord Library] Unknown interaction`);

        // Отправляем данные об ошибке и отправляем через систему webhook
        client.sendWebhook = {
            username: client.user.username, avatarURL: client.user.avatarURL(),
            embeds: [{
                timestamp: Date(),
                title: origin,
                description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                fields: [{
                    name: "Stack:",
                    value: `\`\`\`${err.stack}\`\`\``
                }],
                color: Colors.DarkRed,
            }]
        };

        // Если получена критическая ошибка, из-за которой будет нарушено выполнение кода
        if (err.message?.match(/Critical/)) {
            Logger.log("ERROR", `[CODE: <14>] Hooked critical error!`);
            process.exit(14);
        }

        // Выводим ошибку
        Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);
    });
}