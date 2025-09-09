import { Assign, Logger } from "#structures";
import { Event } from "#handler/events";
import { homepage } from "package.json";
import { Events } from "discord.js";
import { db } from "#app/db";

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

                // Получаем владельца сервера
                const owner = guild.members.cache.get(guild.ownerId);

                // Если владельца не удалось найти
                if (!owner) return null;

                try {
                    // Отправляем сообщение владельцу сервера
                    return owner.send({
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
                                        "content": `# 💫 For owner of Guild ||${guild}|| \n` +
                                            `👋 Hi listener, thanks for adding the bot to your server, if it wasn't you, another user with privilege could have done it\n` +
                                            `## 💣 Features\n` +
                                            `- 💵 No premium\n` +
                                            `- 🪛 Not using lava services such as lavalink, lavaplayer\n` +
                                            `- 🎶 Smooth transitions between tracks, they are still raw!\n` +
                                            `- 🪪 More detailed track data with dynamic message about the current track\n` +
                                            `- 🎛 Access to filters, yes you have full access to audio filters, many bots provide paid access!`,
                                    },
                                    {
                                        "type": 14, // Separator
                                        "divider": true,
                                        "spacing": 1
                                    },
                                    {
                                        "type": 10, // Text
                                        "content": `## 📑 Support\n`+
                                            `- 📣 If you find a mistake or have any ideas, please post them on github, discord\n` +
                                            `- 🗃 Default support platform: YouTube, Spotify, SoundCloud, Yandex, VK`
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