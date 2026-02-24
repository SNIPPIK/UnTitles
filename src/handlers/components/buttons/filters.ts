import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "filters";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);
        const filters = queue.player.filters;

        // Если нет фильтров
        if (filters.size === 0) {
            return ctx.write({
                embeds: [{
                    description:  locale._(ctx.interaction.locale, "player.button.filter.zero"),
                    color: Colors.White
                }],
                flags: MessageFlags.Ephemeral
            });
        }

        // Отправляем список включенных фильтров
        return ctx.write({
            embeds: [{
                description: locale._(ctx.interaction.locale, "player.button.filter"),
                color: Colors.White,
                author: {
                    name: `${locale._(ctx.interaction.locale, "filters")} - ${ctx.guild("cache").name}`,
                    icon_url: queue.tracks.track.artist.image.url
                },
                thumbnail: {
                    url: ctx.guild("cache").iconURL()
                },

                fields: filters.array.map((item) => {
                    return {
                        name: item.name,
                        value: item.locale[ctx.author.locale] ?? item.locale["en-US"],
                        inline: true
                    }
                }),
                timestamp: new Date().toString()
            }],
            flags: MessageFlags.Ephemeral
        });
    };
}