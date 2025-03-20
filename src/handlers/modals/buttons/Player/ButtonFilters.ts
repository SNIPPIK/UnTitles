import {locale} from "@service/locale";
import {Button} from "@handler/modals";
import {Colors} from "discord.js";
import {Assign} from "@utils";

class ButtonFilters extends Assign<Button> {
    public constructor() {
        super({
            name: "filters",
            callback: (msg) => {
                const queue = msg.queue;
                const filters = queue.player.filters.enabled;

                // Если нет фильтров
                if (filters.length === 0) {
                    msg.FBuilder = {
                        description: locale._(msg.locale, "player.button.filter.zero"),
                        color: Colors.White
                    };
                    return;
                }

                // Отправляем список включенных фильтров
                new msg.builder().addEmbeds([
                    {
                        description: locale._(msg.locale, "player.button.filter"),
                        color: Colors.White,
                        author: {
                            name: `${locale._(msg.locale, "filters")} - ${msg.guild.name}`,
                            iconURL: queue.tracks.track.artist.image.url
                        },
                        thumbnail: {
                            url: msg.guild.iconURL()
                        },

                        fields: filters.map((item) => {
                            return {
                                name: item.name,
                                value: item.locale[msg.locale] ?? item.locale["en-US"],
                                inline: true
                            }
                        }),
                        timestamp: new Date()
                    }
                ]).send = msg;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default Object.values({ButtonFilters});