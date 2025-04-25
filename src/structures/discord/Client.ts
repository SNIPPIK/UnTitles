import {Client, Partials, Options} from "discord.js";

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
    };
}