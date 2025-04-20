import {Client, ShardingManager, IntentsBitField, Partials, Options, Colors, WebhookClient} from "discord.js";
import {DiscordGatewayAdapterCreator, VoiceConnection} from "@service/voice";
import {ActivityType} from "discord-api-types/v10";
import {isMainThread} from "node:worker_threads";
import {ActivityOptions} from "@type/discord";
import {Logger, Collection} from "@utils";
import {env} from "@handler";
import {global} from "@type";

// db modules
import {CacheUtility} from "@service/player/utils/cache";
import {RestObject} from "@handler/rest/apis";
import {Commands} from "@handler/commands";
import {Buttons} from "@handler/modals";
import {Events} from "@handler/events";
import {Queues} from "@service/player";

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 * @public
 */
export class Database {
    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения запросов на платформы
     * @readonly
     * @public
     */
    public readonly api = new RestObject();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения событий
     * @readonly
     * @public
     */
    public readonly events = new Events();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @description Здесь хранятся все очереди для серверов, для 1 сервера 1 очередь и плеер
     * @readonly
     * @public
     */
    public readonly queues = new Queues();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения голосовых подключений
     * @readonly
     * @public
     */
    public readonly voice = new class db_voice_system extends Collection<VoiceConnection> {
        /**
         * @description Подключение к голосовому каналу
         * @param config - Данные для подключения
         * @param adapterCreator - Для отправки пакетов
         * @public
         */
        public join = (config: VoiceConnection["config"], adapterCreator: DiscordGatewayAdapterCreator) => {
            let connection = this.get(config.guild_id);

            // Если нет голосового подключения
            if (!connection) {
                // Если нет голосового подключения, то создаем
                connection = new VoiceConnection(config, adapterCreator);
                this.set(config.guild_id, connection);
            }

            // Если есть голосовое подключение
            else connection.rejoin();

            return connection;
        };
    };

    /**
     * @author SNIPPIK
     * @description Класс для кеширования аудио и данных о треках
     * @readonly
     * @public
     */
    public readonly cache = new CacheUtility();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения кнопок бота
     * @description Класс хранящий в себе все кнопки для бота
     * @readonly
     * @public
     */
    public readonly buttons = new Buttons();

    /**
     * @author SNIPPIK
     * @description Загружаем класс для хранения команд
     * @readonly
     * @public
     */
    public readonly commands = new Commands();

    /**
     * @description Для управления белым списком пользователей
     * @readonly
     * @public
     */
    public readonly whitelist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("whitelist"),
        ids: env.get("whitelist.list", "").split(",")
    };

    /**
     * @description Для управления черным списком пользователей
     * @readonly
     * @public
     */
    public readonly blacklist: {toggle: boolean; ids: string[]} = {
        toggle: env.get<boolean>("blacklist"),
        ids: env.get("blacklist.list", "").split(",")
    };

    /**
     * @description Для работы с командами для разработчика
     * @readonly
     * @public
     */
    public readonly owner: {ids: string[]; guildID: string} = {
        guildID: env.get("owner.server"),
        ids: env.get("owner.list").split(",")
    };

    /**
     * @description Для отображения в embed сообщениях
     * @readonly
     * @public
     */
    public readonly images: {disk: string; no_image: string; loading: string} = {
        disk: env.get("image.currentPlay"),
        no_image: env.get("image.not"),
        loading: env.get("loading.emoji")
    };
}

/**
 * @author SNIPPIK
 * @description Экспортируем базу данных глобально
 * @class Database
 * @public
 */
export var db: Database = null;

/**
 * @author SNIPPIK
 * @description Запуск всего проекта в async режиме
 */
(async () => {
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
            const manager = new ShardingManager(__filename, {
                execArgv: ["-r", "tsconfig-paths/register"],
                token: env.get("token.discord"),
                mode: "process",
                respawn: true,
                silent: false
            });

            // Слушаем событие для создания осколка
            manager.on("shardCreate", async (shard) => {
                shard.setMaxListeners(3);
                shard.on("spawn", () => Logger.log("LOG", `[Manager/${shard.id}] shard ${Logger.color(36, `added to manager`)}`));
                shard.on("ready", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(36, `ready`)}`));
                shard.on("death", () => Logger.log("LOG", `[Manager/${shard.id}] shard is ${Logger.color(31, `killed`)}`));
            });
            manager.setMaxListeners(1);

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
            const webhookToken = env.get<string>("webhook.token", null);
            const webhookID = env.get("webhook.id", null);
            const webhook = webhookID && webhookToken ? new WebhookClient({ id: webhookID, token: webhookToken }) : null;

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

                // Позволяет обрабатывать частичные данные
                partials: [
                    Partials.Channel,
                    Partials.GuildMember,
                    Partials.Message,
                    Partials.Reaction,
                    Partials.User,
                    Partials.GuildScheduledEvent,
                    Partials.ThreadMember
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
                    GuildTextThreadManager: 0
                })
            });
            const id = client.shard?.ids[0] ?? 0;

            db = new Database();
            Logger.log("LOG", `[Core/${id}] has ${Logger.color(34, `initialize db`)}`);

            // Подключаем осколок к discord
            client.login(env.get("token.discord"))
                // Что делаем после того как бот подключится к discord api
                .then(async () => {
                    Logger.log("WARN", `[Core/${id}] connected to discord as ${Logger.color(35, client.user.tag)}`);

                    // Даем разрешение на запуск интервала
                    if (id === 0) {
                        // Время обновления статуса
                        const timeout = parseInt(env.get("client.presence.interval"));

                        // Интервал для обновления статуса
                        setInterval(async () => {
                            // Задаем статус боту
                            client.user.setPresence({
                                status: env.get("client.status", "online"),
                                activities: [
                                    {
                                        name: env.get("client.presence.name", "I ❤️ UnTitles bot"),
                                        type: ActivityType[env.get("client.presence.type", "Watching")],
                                    }
                                ] as ActivityOptions[],
                            });
                        }, timeout * 1e3);
                    }
                })

                // Что делаем после подключения к discord api
                .finally(async () => {
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

            // Отлавливаем все ошибки внутри процесса
            process.on("uncaughtException", (err, origin) => {
                //Выводим ошибку
                Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);

                // Отправляем данные об ошибке и отправляем через систему webhook
                if (webhook) webhook.send({
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
            });
            break;
        }
    }
})();