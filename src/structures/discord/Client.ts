import {Client, Partials, Options} from "discord.js";
import {ActivityType} from "discord-api-types/v10"
import {env} from "@app";

/**
 * @author SNIPPIK
 * @description Класс клиента
 * @class DiscordClient
 */
export class DiscordClient extends Client {
    public constructor() {
        super({
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
        this.IntervalStatus();
    };

    /**
     * @description Функция создания и управления статусом
     * @private
     */
    private IntervalStatus = () => {
        // Время обновления статуса
        const timeout = parseInt(env.get("client.presence.interval"));
        const array: { name: string; type: ActivityType }[] = JSON.parse(env.get("client.presence.array"));
        const size = array.length - 1;
        let i = 0;

        // Интервал для обновления статуса
        setInterval(async () => {
            // Запрещаем выходить за диапазон допустимого значения
            if (i > size) i = 0;
            const activity = array[i];
            i++;

            // Задаем статус боту
            this.user.setPresence({
                status: env.get("client.status", "online"),
                activities: [
                    {
                        name: activity.name,
                        type: ActivityType[activity.type as any] as any
                    }
                ] as ActivityOptions[],
                shardId: this.shard?.ids[0] ?? 0
            });

        }, timeout * 1e3);
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