import {Client, Partials, Options, SimpleShardingStrategy} from "discord.js";
import {ActivityType} from "discord-api-types/v10"
import {version} from "../../../package.json";
import {Logger} from "@utils";
import {env} from "@app/env";
import {db} from "../../database";

/**
 * @author SNIPPIK
 * @description Класс клиента
 * @class DiscordClient
 */
export class DiscordClient extends Client {
    /**
     * @description Номер осколка
     * @public
     */
    public get shardID() {
        return this.shard?.ids[0] ?? 0;
    };

    /**
     * @description Создание стандартного осколка
     * @public
     */
    public constructor() {
        super({
            ws: {
                buildStrategy(ws) {
                    const browser = env.get("client.browser", "discord.js");
                    if (browser) ws.options.identifyProperties.browser = browser;

                    return new SimpleShardingStrategy(ws);
                }
            },

            // Права бота
            intents: [
                "Guilds",
                "GuildMessages",
                "GuildVoiceStates",
                "GuildIntegrations",
                "GuildExpressions",
                "DirectMessages"
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

        // Устанавливаем параметр debug
        if (!Logger.debug) {
            const debug = env.get<string>("NODE_ENV", "production") === "development";

            // Событие отладки
            if (debug) {
                this.on("debug", async (message) => {
                    Logger.log("DEBUG", message);
                });
            }

            Logger.debug = debug;
        }

        // Запускаем статусы после инициализации клиента
        this.once("ready", this.IntervalStatus);
    };

    /**
     * @description Функция создания и управления статусом
     * @readonly
     * @private
     */
    private readonly IntervalStatus = () => {
        // Время обновления статуса
        const timeout = parseInt(env.get("client.presence.interval"));
        const array = this.parseStatuses();
        const size = array.length - 1;
        let i = 0;

        // Интервал для обновления статуса
        setInterval(() => {
            // Обновление статистики
            array[1].name = `guilds ${this.guilds.cache.size}`;
            array[2].name = `queues ${db.queues.size}`;

            // Запрещаем выходить за диапазон допустимого значения
            if (i > size) i = 0;
            const activity = array[i];
            i++;

            // Задаем статус боту
            this.user.setPresence({
                status: env.get("client.status", "online"),
                activities: [activity] as ActivityOptions[],
                shardId: this.shard?.ids[0] ?? 0
            });

        }, timeout * 1e3);
    };

    /**
     * @description Функция подготавливающая статусы
     * @readonly
     * @private
     */
    private readonly parseStatuses = () => {
        const statuses: ActivityOptions[] = [
            // Статус с версией
            {
                name: `version ${version}`,
                type: ActivityType["Watching"],
                shardId: this.shardID
            },

            // Статус о кол-во гильдий
            {
                name: `guilds`,
                type: ActivityType["Watching"],
                shardId: this.shardID
            },

            // Статус о кол-во музыкальных очередей
            {
                name: `queues`,
                type: ActivityType["Streaming"],
                shardId: this.shardID
            }
        ];

        // Получаем пользовательские статусы
        try {
            const envPresents = (JSON.parse(env.get("client.presence.array")) as ActivityOptions[]).map((status) => {
                return {
                    name: status.name,
                    type: ActivityType[status.type] as any,
                    shardId: this.shardID
                }
            });

            // Добавляем пользовательские статусы
            statuses.push(...envPresents);
            Logger.log("LOG", `[Core/${this.shardID}] Success loading custom ${Logger.color(34, `${envPresents.length} statuses`)}`);
        } catch (e) {
            Logger.log("ERROR", `[Core/${this.shardID}] Failed to parse env statuses. ${e}`);
        }

        return statuses;
    };
}


/**
 * @author SNIPPIK
 * @description Параметры показа статуса
 * @interface ActivityOptions
 */
interface ActivityOptions {
    name: string;
    state?: string;
    url?: string;
    type?: ActivityType;
    shardId?: number | readonly number[];
}