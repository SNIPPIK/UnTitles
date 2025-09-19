import { ChannelType, Events, PermissionsBitField, TextChannel } from "discord.js";
import { Assign, Logger } from "#structures";
import { Event } from "#handler/events";
import { homepage } from "package.json";
import { db } from "#app/db";

// Список прав, которые проверяем
const REQUIRED_PERMISSIONS = [
    PermissionsBitField.Flags.SendMessages,       // Отправка сообщений
    PermissionsBitField.Flags.EmbedLinks,         // Вставка ссылок/встраиваемых сообщений
    PermissionsBitField.Flags.ViewChannel
];

/**
 * @author SNIPPIK
 * @description Класс события GuildCreate
 * @class GuildCreate
 * @extends Assign
 * @event Events.GuildCreate
 * @public
 *
 * @license BSD-3-Clause + custom restriction | Эта команда защищена лицензией проекта, изменение или удаление строго запрещено!!!
 */
class GuildCreate extends Assign<Event<Events.GuildCreate>> {
    public constructor() {
        super({
            name: Events.GuildCreate,
            type: "client",
            once: false,
            execute: (guild) => {
                const id = guild.client.shard?.ids[0] ?? 0;
                Logger.log("LOG", `[Core/${id}] has ${Logger.color(32, `added a new guild ${guild.id}`)}`);

                const channel = guild.channels.cache.find((ch): ch is TextChannel => {
                    if (ch.type !== ChannelType.GuildText) return false;

                    const perms = ch.permissionsFor(guild.members.me!);
                    if (!perms) return false;

                    return REQUIRED_PERMISSIONS.every(p => perms.has(p));
                });

                // Если владельца не удалось найти
                if (!channel) return null;

                try {
                    // Отправляем сообщение владельцу сервера
                    return channel.send({
                        flags: "IsComponentsV2",
                        components: [
                            {
                                "type": 17, // Container
                                "components": [
                                    {
                                        "type": 12, // Media
                                        items: [
                                            {
                                                "media": {
                                                    "url": db.images.banner
                                                }
                                            }
                                        ]
                                    },

                                    {
                                        "type": 10, // Text
                                        "content": `# 💫 For users Guild ||${guild}|| \n` +
                                            `👋 Hi listeners, thanks for adding the bot to your server, if it wasn't you, another user with privilege could have done it\n` +
                                            `## 🔊 Voice Engine [without lavalink]\n` +
                                            ` - 🎧 Full **Voice Gateway v8** implementation\n` +
                                            ` - 🔐 Full **SRTP + E2EE** support\n` +
                                            ` - 🎶 Best open-source audio player alternative\n` +
                                            ` - 📦 Adaptive audio packet system with custom \`Jitter Buffer\`\n` +
                                            ` - 🔁 Supported: Autoplay, Repeat, Shuffle, Replay, and more\n` +
                                            `## 🎵 Audio\n` +
                                            ` - 🔄 Reuse audio <8 minutes without conversion\n` +
                                            ` - 🎶 Smooth **fade-in/fade-out**, skip, seek & tp transitions\n` +
                                            ` - 🔀 \`Hot audio swap\` between tracks\n` +
                                            ` - 🎚 16+ built-in filters + custom filter support\n` +
                                            ` - 📺 Long video support & raw Live video\n` +
                                            ` - ⏱ Explicit audio stream synchronization without filters\n` +
                                            `## 🌐 Platforms\n` +
                                            ` - 🌍 Supported: ${db.api.platforms.array.map((api) => db.api.platforms.authorization.includes(api.name) || db.api.platforms.block.includes(api.name) ? `\`${api.name}\`` : `~~${api.name}~~`)}\n` +
                                            ` - 🎵 Audio: ${db.api.platforms.audio.map((api) => `\`${api}\``)}\n` +
                                            ` - 🔍 Precise search by time, name syllables, and related tracks`
                                    },
                                    {
                                        "type": 14, // Separator
                                        "divider": true,
                                        "spacing": 1
                                    },
                                    {
                                        "type": 10, // Text
                                        "content": `## 📑 Support\n`+
                                            `- 📣 If you find a mistake or have any ideas, please post them on github, discord`
                                    }
                                ]
                            },
                            {
                                type: 1,
                                components: [
                                    // Help Guild
                                    {
                                        type: 2,
                                        style: 5,
                                        url: "https://discord.gg/qMf2Sv3",
                                        emoji: { name: "📨" },
                                        label: "Official server"
                                    },

                                    // Github
                                    {
                                        type: 2,
                                        style: 5,
                                        url: homepage as string,
                                        emoji: { name: "🔗" },
                                        label: "Github"
                                    }
                                ]
                            }
                        ]
                    })
                } catch (err) {
                    console.log(err);
                    return null;
                }
            }
        });
    };
}


/**
 * @author SNIPPIK
 * @description Класс события GuildDelete
 * @class GuildDelete
 * @extends Assign
 * @event Events.GuildDelete
 * @public
 */
class GuildRemove extends Assign<Event<Events.GuildDelete>> {
    public constructor() {
        super({
            name: Events.GuildDelete,
            type: "client",
            once: false,
            execute: async (guild) => {
                const id = guild.client.shard?.ids[0] ?? 0;
                Logger.log("LOG", `[Core/${id}] has ${Logger.color(31, `remove a guild ${guild.id}`)}`);

                // Получаем очередь
                const queue = db.queues.get(guild.id);

                // Если есть очередь
                if (queue) db.queues.remove(guild.id);
            }
        });
    };
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [GuildCreate, GuildRemove];