import { Component, DeclareComponent } from "#handler/components";
import { Middlewares } from "#handler/commands";
import filters from "#core/player/filters.json";
import type { AudioFilter } from "#core/player";
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @description Включение или выключения аудио фильтра через контекстное меню
 * @class FilterSelector
 * @extends Component
 * @loadeble
 */
@DeclareComponent({
    name: "filter_select"
})
@Middlewares(["queue", "another_voice", "voice"])
class FilterSelector extends Component<"selector"> {
    public callback: Component["callback"] = (ctx) => {
        const { player } = db.queues.get(ctx.guildId);
        const Filter = filters.find((item) => item.name === ctx["values"][0]) as AudioFilter;
        const seek: number = player.audio.current?.duration ?? 0;

        /* Отключаем фильтр */
        // Если есть включенный фильтр
        if (player.filters.has(Filter)) {
            player.filters.delete(Filter);

            // Если можно выключить фильтр или фильтры сейчас
            if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                player.play(seek).catch(console.error);

                // Сообщаем о включении фильтров
                return ctx.reply({
                    embeds: [
                        {
                            description: locale._(ctx.locale, "command.filter.remove.after", [Filter.name, Filter.locale[ctx.locale].split(" - ").pop()]),
                            color: Colors.Green,
                            timestamp: new Date() as any
                        }
                    ],
                    flags: "Ephemeral"
                });
            }

            // Если нельзя выключить фильтр или фильтры сейчас.
            // Сообщаем о включении фильтров
            return ctx.reply({
                embeds: [
                    {
                        description: locale._(ctx.locale, "command.filter.remove.before", [Filter.name, Filter.locale[ctx.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags: "Ephemeral"
            });
        }

        const unsupportedFilters = player.filters.hasUnsupported(Filter);

        // Проверяем, не конфликтует ли новый фильтр с уже включёнными
        if (unsupportedFilters) return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.filter.push.unsupported", unsupportedFilters),
                    color: Colors.DarkRed
                }
            ],
            flags: "Ephemeral"
        });

        /* Добавляем фильтр */
        player.filters.add(Filter);

        // Если можно включить фильтр или фильтры сейчас
        if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
            player.play(seek).catch(console.error);

            // Сообщаем о включении фильтров
            return ctx.reply({
                embeds: [
                    {
                        description: locale._(ctx.locale, "command.filter.push.before", [Filter.name, Filter.locale[ctx.locale].split(" - ").pop()]),
                        color: Colors.Green,
                        timestamp: new Date() as any
                    }
                ],
                flags:"Ephemeral"
            });
        }

        // Если нельзя включить фильтр или фильтры сейчас.
        // Сообщаем о включении фильтров
        return ctx.reply({
            embeds: [
                {
                    description: locale._(ctx.locale, "command.filter.push.after", [Filter.name, Filter.locale[ctx.locale].split(" - ").pop()]),
                    color: Colors.Green,
                    timestamp: new Date() as any
                }
            ],
            flags: "Ephemeral"
        });
    }
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [FilterSelector];