import { ComponentCommand, type ComponentContext } from 'seyfert';
import { MessageFlags } from 'seyfert/lib/types';
import { Colors } from "#structures/discord";
import { locale } from "#structures";
import { db } from "#app/db";

export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "resume_pause";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);

        const track = queue.tracks.track;

        // Если указан трек которого нет
        if (!track) return null;

        const {name, url} = track;

        // Если плеер уже проигрывает трек
        if (queue.player.status === "player/playing") {
            // Приостанавливаем музыку если она играет
            queue.player.pause();

            // Сообщение о паузе
            return ctx.write({
                flags: MessageFlags.Ephemeral,
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "player.button.pause", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }

        // Если плеер на паузе
        else if (queue.player.status === "player/pause") {
            // Возобновляем проигрывание если это возможно
            queue.player.resume();

            // Сообщение о возобновлении
            return ctx.write({
                flags: MessageFlags.Ephemeral,
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "player.button.resume", [`[${name}](${url})`]),
                        color: Colors.Green
                    }
                ]
            });
        }
        return null;
    };
}