import {Client, ShardingManager, IntentsBitField, Partials, Options, Colors, WebhookClient} from "discord.js";
import {CacheUtility, db_buttons, db_voice, Queues} from "@handler/queues";
import {API_requester} from "@handler/apis";
import {Commands} from "@handler/commands";
import {Events} from "@handler/events";
import {Logger} from "@utils";
import {env} from "@handler";
import {global} from "@type";

// Включение
Logger.log("LOG", `[ZEN|UDB] has starting`);

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
    Logger.log("WARN", `[ZEN|UDB] has running ShardManager...`);

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
        shard.on("spawn", () => Logger.log("WARN",`[ZEN|UDB/${shard.id}] added to manager`));
        shard.on("ready", () => Logger.log("WARN",`[ZEN|UDB/${shard.id}] is connected to websocket`));
        shard.on("death", () => Logger.log("WARN",`[ZEN|UDB/${shard.id}] is killed`));
    });

    // Создаем дубликат
    manager.spawn({ amount: "auto", delay: -1 }).catch((err: Error) => Logger.log("ERROR",`[ShardManager] ${err}`));
}

/**
 * @author SNIPPIK
 * @description Если требуется запустить осколок
 */
else {
    Logger.log("DEBUG", `[ZEN|UDB] adding utilities${global}`);
    Logger.log("WARN", `[ZEN|UDB] has running shard`);

    // Создаем webhook клиент
    const webhook = new WebhookClient({
        id: env.get<string>("webhook.id", null),
        token: env.get<string>("webhook.token", null),
    });

    // Создаем класс осколка
    const client = new Client({
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
        ],

        // Задаем параметры кеша
        makeCache: Options.cacheWithLimits({
            ...Options.DefaultMakeCacheSettings,
            GuildBanManager: 0,
            GuildForumThreadManager: 0,
            AutoModerationRuleManager: 0,
            DMMessageManager: 0,
            GuildScheduledEventManager: 0,
            GuildMessageManager: 0,
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
    Logger.log("LOG", `[ZEN|UDB/${id}] has initialize db`);

    // Подключаем осколок к discord
    client.login(env.get("token.discord")).finally(() => {
        // Загружаем платформы
        db.api.register();
        Logger.log("DEBUG", `[ZEN|UDB/${id} | ${db.api.platforms.supported.length}/${db.api.platforms.authorization.length}] has load apis`);

        // Загружаем события
        db.events.register(client);
        Logger.log("DEBUG", `[ZEN|UDB/${id} | ${db.events.events.length}] has load events`);

        // Загружаем команды
        db.commands.register(client);
        Logger.log("DEBUG", `[ZEN|UDB/${id} | ${db.commands.public.length}] has load commands`);

        // Сообщаем о полной готовности бота
        webhook.send({
            username: "Toolkit", avatarURL: db.images.no_image,
            embeds: [{
                title: `${client.user.username} has running`,
                description: `🪪: ${id}\n🛡:  ${client.guilds.cache.size}`,
                thumbnail: {url: client.user.avatarURL()},
                color: Colors.White,
            }],
        }).catch(() => {
            Logger.log("WARN", "[Webhook] Fail send message");
        });
    });

    // Отлавливаем все ошибки внутри процесса
    process.on("uncaughtException", (err, origin) => {
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
            Logger.log("WARN", "[Webhook] Fail send message");
        });

        // Если получена критическая ошибка, из-за которой будет нарушено выполнение кода
        if (err.message?.match(/Critical/)) {
            Logger.log("ERROR", "[CODE: 14] Hooked critical error!");
            process.exit(14);
        }

        //Выводим ошибку
        Logger.log("ERROR", `Caught exception\n┌ Name:    ${err.name}\n├ Message: ${err.message}\n├ Origin:  ${origin}\n└ Stack:   ${err.stack}`);
    });
}