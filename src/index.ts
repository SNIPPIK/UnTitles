import {Client, ShardingManager, IntentsBitField, Partials, Options, Colors, WebhookClient} from "discord.js";
import {CacheUtility, db_buttons, db_voice, Queues} from "@handler/queues";
import {ActivityType} from "discord-api-types/v10";
import {ActivityOptions} from "@type/discord";
import {API_requester} from "@handler/apis";
import {Commands} from "@handler/commands";
import {Events} from "@handler/events";
import {Logger} from "@utils";
import {env} from "@handler";
import {global} from "@type";

// Включение
Logger.log("LOG", `[Core] has starting`);

/**
 * @author SNIPPIK
 * @description Локальная база данных бота
 * @class Database
 */
class Database {
    /**
     * @description Загружаем класс для хранения запросов на платформы
     * @readonly
     * @private
     */
    public readonly api = new API_requester();

    /**
     * @description Загружаем класс для хранения событий
     * @readonly
     * @private
     */
    public readonly events = new Events();

    /**
     * @description Загружаем класс для хранения очередей, плееров, циклов
     * @readonly
     * @private
     */
    public readonly queues = new Queues();

    /**
     * @description Загружаем класс для хранения голосовых подключений
     * @readonly
     * @private
     */
    public readonly voice = new db_voice();

    /**
     * @description Класс кеширования
     * @readonly
     * @private
     */
    public readonly cache = new CacheUtility();

    /**
     * @description Загружаем класс для хранения кнопок бота
     * @readonly
     * @private
     */
    public readonly buttons = new db_buttons();

    /**
     * @description Загружаем класс для хранения команд
     * @readonly
     * @private
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
        ids: env.get("owner.list").split(","),
        guildID: env.get("owner.server")
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
 */
export var db: Database = null;


/**
 * @author SNIPPIK
 * @description Если требуется запустить менеджер осколков
 */
if (process["argv"].includes("--ShardManager")) {
    Logger.log("WARN", `[Manager] has running ShardManager...`);

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
        shard.on("spawn", () => Logger.log("WARN",`[Manager/${shard.id}] added to manager`));
        shard.on("ready", () => Logger.log("WARN",`[Manager/${shard.id}] is connecting to websocket`));
        shard.on("death", () => Logger.log("WARN",`[Manager/${shard.id}] is killed`));
    });

    // Создаем дубликат
    manager.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[Manager] ${err}`));
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить осколок
 */
else {
    Logger.log("DEBUG", `[Core] adding utilities${global}`);
    Logger.log("WARN", `[Core] has running shard`);

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
    Logger.log("LOG", `[Core/${id}] has initialize db`);

    // Подключаем осколок к discord
    client.login(env.get("token.discord"))
        // Что делаем после того как бот подключится к discord api
        .then(() => {
            Logger.log("WARN", `[Core/${id}] login successfully`);

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
        .catch(() => {
            Logger.log("ERROR", `[Core/${id}] failed authorization in discord`);
        })

        // Что делаем после подключения к discord api
        .finally(() => {
            // Загружаем платформы
            db.api.register();
            Logger.log("DEBUG", `[Core/${id} | ${db.api.platforms.supported.length}/${db.api.platforms.authorization.length}] has load apis`);

            // Загружаем события
            db.events.register(client);
            Logger.log("DEBUG", `[Core/${id} | ${db.events.events.length}] has load events`);

            // Загружаем команды
            db.commands.register(client);
            Logger.log("DEBUG", `[Core/${id} | ${db.commands.public.length}] has load commands`);
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
}