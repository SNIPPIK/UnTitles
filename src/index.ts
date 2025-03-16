import {Client, ShardingManager, IntentsBitField, Partials, Options, Colors, WebhookClient} from "discord.js";
import {ActivityType} from "discord-api-types/v10";
import {ActivityOptions} from "@type/discord";
import {Database} from "./db";
import {Logger} from "@utils";
import {env} from "@handler";
import {global} from "@type";

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 */
export var db: Database = null;

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 */
(async () => {
    switch (process["argv"].includes("--ShardManager")) {
        /**
         * @author SNIPPIK
         * @description Если требуется запустить менеджер осколков
         */
        case true: {
            Logger.log("WARN", `[Manager] has running ${Logger.color(36, `ShardManager...`)}`);

            // Создаем менеджер осколков
            const manager = new ShardingManager(__filename, {
                execArgv: ["-r", "tsconfig-paths/register"],
                token: env.get("token.discord"),
                mode: "process",
                respawn: true,
                silent: false
            });

            // Слушаем событие для создания осколка
            manager.on("shardCreate", (shard) => {
                shard.on("spawn", () => Logger.log("LOG", `[Manager/${shard.id}] shard ${Logger.color(36, `added to manager`)}`));
                shard.on("ready", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(36, `ready`)}`));
                shard.on("death", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(31, `killed`)}`));
            });

            // Создаем дубликат
            manager.spawn({amount: "auto", delay: -1}).catch((err: Error) => Logger.log("ERROR", `[Manager] ${err}`));
            break;
        }

        /**
         * @author SNIPPIK
         * @description Если требуется запустить осколок
         */
        default: {
            Logger.log("DEBUG", `[Core] adding utilities${global}`);
            Logger.log("WARN", `[Core] has running ${Logger.color(36, `shard`)}`);

            // Создаем webhook клиент
            const webhook = new WebhookClient({
                id: env.get<string>("webhook.id", null),
                token: env.get<string>("webhook.token", null)
            });

            // Создаем класс осколка
            const client = new Client({
                // Права бота
                intents: [
                    IntentsBitField.Flags.DirectMessages,
                    IntentsBitField.Flags.GuildExpressions,
                    IntentsBitField.Flags.GuildIntegrations,
                    IntentsBitField.Flags.GuildVoiceStates,
                    IntentsBitField.Flags.GuildMessages,
                    IntentsBitField.Flags.Guilds
                ],

                // Данные которые обязательно надо кешировать
                partials: [
                    Partials.Channel,
                    Partials.GuildMember,
                    Partials.Message,
                    Partials.Reaction,
                    Partials.User
                ],

                // Задаем параметры кеша
                makeCache: Options.cacheWithLimits({
                    ...Options.DefaultMakeCacheSettings,
                    GuildBanManager: 0,
                    GuildForumThreadManager: 0,
                    AutoModerationRuleManager: 0,
                    DMMessageManager: 0,
                    GuildInviteManager: 0,
                    GuildEmojiManager: 0,
                    GuildStickerManager: 0,
                    GuildMemberManager: {
                        maxSize: 10,
                        keepOverLimit: member => member.id === client.user.id
                    }
                })
            });
            const id = client.shard?.ids[0] ?? 0;

            db = new Database();
            Logger.log("LOG", `[Core/${id}] has ${Logger.color(34, `initialize db`)}`);

            // Подключаем осколок к discord
            client.login(env.get("token.discord"))
                // Что делаем после того как бот подключится к discord api
                .then(() => {
                    Logger.log("WARN", `[Core/${id}] connected to discord as ${Logger.color(35, client.user.tag)}`);

                    // Задаем статус боту
                    client.user.setPresence({
                        status: env.get("client.status"),
                        activities: [
                            {
                                name: env.get("client.presence.name", "I ❤️ UnTitles bot"),
                                type: ActivityType[env.get("client.presence.type")],
                            }
                        ] as ActivityOptions[],
                    });
                })

                // Если при входе происходит ошибка
                .catch((err) => {
                    Logger.log("ERROR", `[Core/${id}] failed authorization in discord`);
                    Logger.log("ERROR", err);
                })

                // Что делаем после подключения к discord api
                .finally(() => {
                    // Загруженные кнопки
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

            // Отлавливаем все ошибки внутри процесса
            process.on("uncaughtException", (err, origin) => {
                //Выводим ошибку
                Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);

                // Отправляем данные об ошибке и отправляем через систему webhook
                webhook.send({
                    username: client.user.username, avatarURL: client.user.avatarURL(),
                    embeds: [{
                        title: "Caught exception",
                        description: `\`\`\`${err.name} - ${err.message}\`\`\``,
                        fields: [{
                            name: "Stack:",
                            value: `\`\`\`${err.stack}\`\`\``
                        }],
                        color: Colors.DarkRed,
                    }],
                }).catch(() => {
                    Logger.log("ERROR", "[Webhook] Fail send message");
                });
            });
            break;
        }
    }
})();