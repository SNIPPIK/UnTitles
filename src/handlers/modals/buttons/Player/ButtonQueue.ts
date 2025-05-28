import {Button} from "#handler/modals";
import {locale} from "#service/locale"
import {Assign} from "#utils";
import {db} from "#app/db";

class ButtonQueue extends Assign<Button> {
    public constructor() {
        super({
            name: "queue",
            callback: async (message) => {
                const queue = db.queues.get(message.guild.id);
                let page = parseInt((queue.tracks.position / 5).toFixed(0));
                const pages = queue.tracks.array(5, true) as string[];
                const lang = message.locale;
                const components = [
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
                ];


                return message.reply({
                    flags: "IsComponentsV2",
                    components: [
                        {
                            "type": 10,
                            "content": `# ${locale._(lang, "queue")} - ${message.guild.name}\n${pages[0]}\n`
                        },
                        {
                            "type": 14,
                            "divider": true,
                            "spacing": 1
                        },
                        {
                            "type": 10,
                            "content": locale._(lang, "player.button.queue.footer", [queue.tracks.track.user.username, page + 1, pages.length, queue.tracks.total, queue.tracks.time])
                        },
                        ...components
                    ],
                    withResponse: true
                }).then((msg) => {
                    const message = msg.resource.message;

                    // Создаем сборщик
                    const collector = message.createMessageComponentCollector({
                        time: 60e3, componentType: 2,
                        filter: (click) => click.user.id !== msg.client.user.id
                    });

                    // Собираем кнопки на которые нажал пользователь
                    collector.on("collect", (i) => {
                        // Кнопка переключения на предыдущую страницу
                        if (i.customId === "menu_back") {
                            // Делаем перелистывание на последнею страницу
                            if (page === 0) page = pages.length - 1;
                            else if (pages.length === 1) return null;
                            else page--;
                        }

                        // Кнопка переключения на предыдущую страницу
                        else if (i.customId === "menu_next") {
                            // Делаем перелистывание на первую страницу
                            if (page === pages.length) page = 0;
                            else if (pages.length === 1) return null;
                            else page++;
                        }

                        // Кнопка отмены
                        else if (i.customId === "menu_cancel") {
                            try { return message.delete(); } catch { return null; }
                        }

                        return message.edit({
                            components: [
                                {
                                    "type": 10,
                                    "content": `# ${locale._(lang, "queue")} - ${message.guild.name}\n${pages[page]}\n`
                                },
                                {
                                    "type": 14,
                                    "divider": true,
                                    "spacing": 1
                                },
                                {
                                    "type": 10,
                                    "content": locale._(lang, "player.button.queue.footer", [queue.tracks.track.user.username, page + 1, pages.length, queue.tracks.total, queue.tracks.time])
                                },
                                ...components
                            ]
                        })
                    });

                    // Таймер для удаления сообщения
                    setTimeout(() => {
                        message.delete().catch(() => null);
                    }, 60e3);
                })
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonQueue];