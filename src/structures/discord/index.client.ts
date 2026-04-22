import { Client, Options, Partials } from "discord.js";
import { ActivityType } from "discord-api-types/v10";
import { Logger } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс клиента
 * @class DiscordClient
 * @extends Client
 * @public
 */
export class DiscordClient extends Client {
    /**
     * @description ID осколка полученный от менеджера
     * @private
     */
    private _shard_ID = 0;

    /**
     * @description Номер осколка
     * @returns number
     * @public
     */
    public get shardID(): number {
        try {
            return this._shard_ID;
        } catch {
            return 0;
        }
    };

    /**
     * @description Уникальный ID бота
     * @public
     */
    public get id() {
        return this.user.id;
    };

    /**
     * @description Создание стандартного осколка
     * @constructor
     * @public
     */
    public constructor() {
        super({
            presence: {
                status: "online",
                activities: [
                    {
                        name: " 💫 Startup...",
                        type: 4
                    }
                ]
            },

            // Права бота
            intents: [
                // Доступ к серверам
                "Guilds",

                // Отправление сообщений
                "GuildMessages",

                // Нужен для голосовой системы
                "GuildVoiceStates"
            ],

            // Позволяет обрабатывать частичные данные
            partials: [
                Partials.Channel,
                Partials.GuildMember,
                Partials.SoundboardSound,
                Partials.Message,
                Partials.Reaction,
                Partials.User,
                Partials.GuildScheduledEvent,
                Partials.ThreadMember
            ],

            // Задаем параметры кеша
            makeCache: Options.cacheWithLimits({
                ...Options.DefaultMakeCacheSettings,
                ...Options.DefaultSweeperSettings,
                MessageManager: {
                    keepOverLimit: (value) => value.createdTimestamp > (Date.now() + 60e3 * 10)
                },
                GuildScheduledEventManager: 0,
                GuildTextThreadManager: 0,
                ReactionManager: 0,
                ReactionUserManager: 0,
                EntitlementManager: 0,
                StageInstanceManager: 0,
                GuildBanManager: 0,
                GuildForumThreadManager: 0,
                AutoModerationRuleManager: 0,
                DMMessageManager: 0,
                GuildInviteManager: 0,
                GuildEmojiManager: 0,
                GuildStickerManager: 0,
                ThreadManager: 0,
                ThreadMemberManager: 0,
            })
        });

        /**
         * @description Получение ответа от WS
         */
        this.ws.on("hello", (id) => {
            this._shard_ID = id;
        });

        // Ограничиваем кол-во событий
        this.setMaxListeners(10);
        this.ws.setMaxListeners(10);
    };

    /**
     * @description Функция создания и управления статусом через рекурсивный setTimeout
     * @readonly
     * @private
     */
    public startIntervalStatuses = () => queueMicrotask(() => {
        // Конфигурация из ENV
        const timeoutMs = parseInt(env.get("client.presence.interval", "120")) * 1e3;
        const arrayUpdateMs = parseInt(env.get("client.presence.array.update", "3600")) * 1e3;
        const botStatus = env.get("client.status", "online") as any;

        let array = this.parseStatuses();
        let i = 0;
        let lastUpdateDate = Date.now();

        // Если статусов нет — выходим
        if (!array.length) return;

        // Рекурсивная функция обновления
        const updatePresence = () => {
            try {
                // Проверяем, пора ли парсить массив статусов
                if (Date.now() - lastUpdateDate > arrayUpdateMs) {
                    array = this.parseStatuses();
                    lastUpdateDate = Date.now();
                }

                // Сброс индекса, если вышли за пределы массива
                if (i >= array.length) i = 0;

                const activity = array[i];

                // Установка присутствия в Seyfert
                this.user.setPresence({
                    afk: false,
                    status: botStatus,
                    activities: [activity] as any[]
                });

                i++;
            } catch (error) {
                console.error("[PresenceUpdate]: Failed to set presence:", error);
            } finally {
                // Планируем следующий запуск в любом случае
                setTimeout(updatePresence, timeoutMs);
            }
        };

        // Запускаем первую итерацию
        updatePresence();
    });

    /**
     * @description Функция подготавливающая статусы
     * @readonly
     * @private
     */
    private parseStatuses = () => {
        const statuses: ActivityOptions[] = [];
        const guilds = this.guilds.cache.size;
        const users = this.users.cache.size;

        // Получаем пользовательские статусы
        try {
            const envPresents = (JSON.parse(`[${env.get("client.presence.array")}]`) as ActivityOptions[]).map((status) => {
                const edited = status.name
                    .replace(/{shard}/g, `${this.shardID + 1}`)
                    .replace(/{queues}|{players}/g, `${db.queues.size}`)
                    .replace(/{guilds}/g, `${guilds}`)
                    .replace(/{users}/g, `${users}`)

                return {
                    name: edited,
                    type: ActivityType[status.type] as any
                }
            });

            // Добавляем пользовательские статусы
            statuses.push(...envPresents);
        } catch (e) {
            Logger.log("ERROR", `[Client/Status] Failed to parse env statuses. ${e}`);
        }

        return statuses;
    };
}

/**
 * @author SNIPPIK
 * @description Параметры показа статуса
 * @interface ActivityOptions
 * @private
 */
interface ActivityOptions {
    name: string;
    state?: string;
    url?: string;
    type?: ActivityType;
    shardId?: number | readonly number[];
}

/**
 * @author SNIPPIK
 * @description Данные статуса бота из env
 * @interface ActivityOptionsRaw
 * @private
 */
//@ts-ignore
interface ActivityOptionsRaw extends ActivityOptions {
    type?: string;
}