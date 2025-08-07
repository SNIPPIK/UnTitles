import filters from "#core/player/filters.json";
import { Selector } from "#handler/components";
import { Assign, locale } from "#structures";
import { Colors } from "#structures/discord";
import { AudioFilter } from "#core/player";
import { db } from "#app/db";

/**
 * @description Кнопка stop, отвечает за остановку проигрывания
 * @class ButtonStop
 * @extends Assign
 * @loadeble
 */
class ButtonStop extends Assign<Selector> {
    public constructor() {
        super({
            name: "filter_select",
            callback: (ctx) => {
                const queue = db.queues.get(ctx.guildId);

                // Если нет очереди
                if (!queue) return null;

                const { player } = queue;
                const name: string = ctx["values"][0];
                const Filter = filters.find((item) => item.name === name) as AudioFilter;
                const findFilter = queue.player.filters.enabled.find((fl) => fl.name === Filter.name);
                const seek: number = queue.player.audio.current?.duration ?? 0;


                /* Отключаем фильтр */
                // Если есть включенный фильтр
                if (findFilter) {
                    player.filters.enabled.delete(findFilter);

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


                /* Включаем фильтр */
                // Если можно включить фильтр или фильтры сейчас
                if (player.audio.current.duration < player.tracks.track.time.total - db.queues.options.optimization) {
                    player.filters.enabled.add(Filter);
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
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ButtonStop];