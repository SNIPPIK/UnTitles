import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";
import {db} from "@app";

class ButtonFilters extends Assign<Button> {
    public constructor() {
        super({
            name: "filters",
            callback: (message) => {
                const queue = db.queues.get(message.guild.id);
                const filters = queue.player.filters.enabled;

                // Если нет фильтров
                if (filters.length === 0) {
                    return message.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(message.locale, "player.button.filter.zero"),
                                color: Colors.White
                            }
                        ]
                    });
                }

                // Отправляем список включенных фильтров
                return message.reply({
                    flags: "Ephemeral",
                    embeds: [
                        {
                            description: locale._(message.locale, "player.button.filter"),
                            color: Colors.White,
                            author: {
                                name: `${locale._(message.locale, "filters")} - ${message.guild.name}`,
                                icon_url: queue.tracks.track.artist.image.url
                            },
                            thumbnail: {
                                url: message.guild.iconURL()
                            },

                            fields: filters.map((item) => {
                                return {
                                    name: item.name,
                                    value: item.locale[message.locale] ?? item.locale["en-US"],
                                    inline: true
                                }
                            }),
                            timestamp: new Date() as any
                        }
                    ]
                });
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonFilters];