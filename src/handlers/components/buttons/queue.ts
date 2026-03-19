import { ComponentCommand, type ComponentContext } from "seyfert";
import { Colors } from "#structures/discord";
import { MessageFlags } from "seyfert/lib/types";
import { locale, Logger} from "#structures";
import { db } from "#app/db";

export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "queue";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const lang = ctx.interaction.locale;
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
                                "content": `## ${db.images.disk_emoji} **[${track.artist.title}](${track.artist.url})**`
                            },
                            {
                                "type": 10,
                                "content": `### **[${track.name}](${track.url})**\n> ${track.footer}`
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
                            "content": `# ${locale._(lang, "queue")} - ${ctx.guild("cache").name}`
                        },
                        ...components,
                        {
                            "type": 10, // Text
                            "content": `-# <t:${queue.timestamp}>`
                        },
                        {
                            "type": 10, // Text
                            "content": locale._(lang, "player.button.queue.footer", [queue.tracks.track.user.username, page, pages, queue.tracks.total, queue.tracks.time])
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
            const message = await ctx.editOrReply({ flags: MessageFlags.IsComponentsV2, components: getContainer(0) }, true);

            // Создаем сборщик
            const collector = message.createComponentCollector({
                filter: (click) => click.user.id !== message.client.me.id
            });

            // Таймер для удаления сообщения
            const timer = setTimeout(() => {
                collector.stop();
                ctx.deleteResponse();
            }, 60e3);

            // Собираем кнопки на которые нажал пользователь
            collector.run("menu_back", () => {
                // Делаем перелистывание на последнею страницу
                if (pages === 1) return null;
                else if (page === 0) page = pages - 1;
                else page--;

                // Редактируем сообщение
                return ctx.editOrReply({components: getContainer(page)});
            });

            // Собираем кнопки на которые нажал пользователь
            collector.run("menu_next", () => {
                // Делаем перелистывание на первую страницу
                if (pages === 1) return null;
                else if (page >= pages) page = 0;
                else page++;

                // Редактируем сообщение
                return ctx.editOrReply({components: getContainer(page)});
            });


            // Собираем кнопки на которые нажал пользователь
            collector.run("menu_cancel", () => {
                clearTimeout(timer);

                try {
                    collector.stop();
                    ctx.deleteResponse();
                } catch {
                    return null;
                }
            });
        } catch (error) {
            Logger.log("ERROR", `[Failed send message/queue]: ${error}`);
        }
    };
}