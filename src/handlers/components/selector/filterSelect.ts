import { ComponentCommand, type ComponentContext, Middlewares } from 'seyfert';
import filters from "#core/player/filters.json";
import { MessageFlags } from "seyfert/lib/types";
import { AudioFilter } from "#core//player";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

@Middlewares(["checkAnotherVoice", "userVoiceChannel"])
export default class extends ComponentCommand {
    componentType = 'StringSelect' as const;

    filter(context: ComponentContext<typeof this.componentType>) {
        return context.customId === 'filter_select';
    };

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);

        // Если нет очереди
        if (!queue) return null;

        const { player } = queue;
        const name: string = ctx.interaction.data["values"][0];
        const Filter = filters.find((item) => item.name === name) as AudioFilter;
        const findFilter = queue.player.filters.find((fl) => fl.name === Filter.name);
        const seek: number = queue.player.audio.current?.duration ?? 0;


        /* Отключаем фильтр */
        // Если есть включенный фильтр
        if (findFilter) {
            player.filters.delete(findFilter);

            // Если можно выключить фильтр или фильтры сейчас
            if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                player.play(seek).catch(console.error);

                // Сообщаем о включении фильтров
                return ctx.write({
                    embeds: [
                        {
                            description: locale._(ctx.interaction.locale, "command.filter.remove.after", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                            color: Colors.Green,
                            timestamp: new Date() as any
                        }
                    ],
                    flags: MessageFlags.Ephemeral
                });
            }

            // Если нельзя выключить фильтр или фильтры сейчас.
            // Сообщаем о включении фильтров
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.remove.before", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }


        /* Включаем фильтр */
        // Если можно включить фильтр или фильтры сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.filters.add(Filter);
            player.play(seek).catch(console.error);

            // Сообщаем о включении фильтров
            return ctx.write({
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "command.filter.push.before", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: MessageFlags.Ephemeral
            });
        }

        // Если нельзя включить фильтр или фильтры сейчас.
        // Сообщаем о включении фильтров
        return ctx.write({
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "command.filter.push.after", [Filter.name, Filter.locale[ctx.interaction.locale].split(" - ").pop()]),
                    color: Colors.Green,
                    timestamp: new Date() as any
                }
            ],
            flags: MessageFlags.Ephemeral
        });
    };
}