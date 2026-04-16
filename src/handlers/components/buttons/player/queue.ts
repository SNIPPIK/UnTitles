import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { locale, Logger } from "#structures";
import { Colors } from "#structures/discord";
import { db } from "#app/db";

/**
 * @description Кнопка queue, отвечает за показ текущих треков
 * @class ButtonQueue
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "queue"
})
@Middlewares(["queue", "another_voice", "voice"])
class ButtonQueue extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const lang = ctx.locale;
        const queue = db.queues.get(ctx.guildId);
        let page = Math.max(Math.ceil(queue.tracks.position / 5), 1);
        const pages = Math.ceil(queue.tracks.total / 5);

        // Получаем контейнер на 2 версии компонентов
        const getContainer = (position: number) => {
            const components = [];

            // Переводим треки в новый стиль!
            for (const track of queue.tracks.array(5, position * 5)) {
                components.push(
                    {
                        "type": 9,
                        "components": [
                            {
                                "type": 10,
                                "content": `### ${db.images.disk_emoji} **[${track.artist.title}](${track.artist.url})**`
                            },
                            {
                                "type": 10,
                                "content": `### **[${track.name}](${track.url})**\n-# ${track.time.split} - ${track.api.name.toLowerCase()} | ${track.user.username}`
                            }
                        ],
                        "accessory": {
                            "type": 11,
                            "media": {
                                "url": track.image.url
                            }
                        }
                    },
                    {
                        "type": 14, // Separator
                        "divider": true,
                        "spacing": 1
                    },
                );
            }

            return [
                {
                    "type": 17, // Container
                    "accent_color": Colors.White,
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
                            "content": `# ${locale._(lang, "queue")} - ${ctx.guild.name}`
                        },
                        ...components,
                        {
                            "type": 10, // Text
                            "content": `-# <t:${queue.timestamp}>`
                        },
                        {
                            "type": 10, // Text
                            "content": locale._(lang, "player.button.queue.footer", [queue.tracks.track.user.username, page + 1, pages, queue.tracks.total, queue.tracks.time])
                        },

                        // Кнопки
                        {
                            type: 1,
                            components: [
                                {
                                    type: 2,
                                    style: 2,
                                    emoji: {
                                        name: "⬅"
                                    },
                                    custom_id: "menu_back",
                                },
                                {
                                    type: 2,
                                    style: 4,
                                    emoji: {
                                        name: "🗑️"
                                    },
                                    custom_id: "menu_cancel"
                                },
                                {
                                    type: 2,
                                    style: 2,
                                    emoji: {
                                        name: "➡"
                                    },
                                    custom_id: "menu_next"
                                }
                            ]
                        },
                    ]
                }
            ];
        };

        try {
            // Отправляем сообщение
            const msg = await ctx.reply({flags: "IsComponentsV2", components: getContainer(0), withResponse: true});
            const resource = msg?.resource?.message;

            // Если нет ответа от API
            if (!resource) return;

            // Создаем сборщик
            const collector = resource.createMessageComponentCollector({
                time: 60e3, componentType: 2,
                filter: (click) => click.user.id !== msg.client.user.id
            });

            // Собираем кнопки на которые нажал пользователь
            collector.on("collect", (i) => {
                // Кнопка переключения на предыдущую страницу
                if (i.customId === "menu_back") {
                    // Делаем перелистывание на последнею страницу
                    if (pages === 1) return null;
                    else if (page === 0) page = pages - 1;
                    else page--;
                }

                // Кнопка переключения на предыдущую страницу
                else if (i.customId === "menu_next") {
                    // Делаем перелистывание на первую страницу
                    if (pages === 1) return null;
                    else if (page >= pages) page = 0;
                    else page++;
                }

                // Кнопка отмены
                else if (i.customId === "menu_cancel") {
                    try {
                        collector.stop();
                        return resource.delete();
                    } catch {
                        return null;
                    }
                }

                // Редактируем сообщение
                return resource.edit({components: getContainer(page)});
            });

            // Таймер для удаления сообщения
            setTimeout(() => {
                collector.stop();
                if (resource.deletable) resource.delete().catch(() => null);
            }, 60e3);
        } catch (error) {
            Logger.log("ERROR", `[Failed send message/queue]: ${error}`);
        }
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonQueue];