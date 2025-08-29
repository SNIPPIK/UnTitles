import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Кнопка filters, отвечает за отображение включенных фильтров
 * @class ButtonFilters
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "filters"
})
@Middlewares(["queue", "another_voice", "voice", "player-wait-stream"])
class ButtonFilters extends Component<"button"> {
    public callback: Component<"button">["callback"] = async (ctx) => {
        const queue = db.queues.get(ctx.guildId);
        const filters = queue.player.filters;

        // Если нет фильтров
        if (filters.size === 0) {
            return ctx.reply({
                flags: "Ephemeral",
                embeds: [
                    {
                        description: locale._(ctx.locale, "player.button.filter.zero"),
                        color: Colors.White
                    }
                ]
            });
        }

        // Отправляем список включенных фильтров
        return ctx.reply({
            flags: "Ephemeral",
            embeds: [
                {
                    description: locale._(ctx.locale, "player.button.filter"),
                    color: Colors.White,
                    author: {
                        name: `${locale._(ctx.locale, "filters")} - ${ctx.guild.name}`,
                        icon_url: queue.tracks.track.artist.image.url
                    },
                    thumbnail: {
                        url: ctx.guild.iconURL()
                    },

                    fields: filters.array.map((item) => {
                        return {
                            name: item.name,
                            value: item.locale[ctx.locale] ?? item.locale["en-US"],
                            inline: true
                        }
                    }),
                    timestamp: new Date() as any
                }
            ]
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonFilters];