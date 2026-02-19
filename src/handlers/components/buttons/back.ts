import {ComponentCommand, type ComponentContext} from 'seyfert';
import {Colors} from "#structures/discord";
import {MessageFlags} from 'seyfert/lib/types';
import {locale} from "#structures";
import {db} from "#app/db";

export default class extends ComponentCommand {
    componentType = 'Button' as const;

    filter(ctx: ComponentContext<typeof this.componentType>) {
        return ctx.customId === "back";
    }

    async run(ctx: ComponentContext<typeof this.componentType>) {
        const queue = db.queues.get(ctx.guildId);
        const position = queue.tracks.position;

        // Если трек уже какое-то время играет
        if (
            // Если есть аудио поток
            queue.player.audio.current &&
            // Если время аудио позволяет вернутся
            (queue.player.audio.current?.duration > db.queues.options.optimization)
        ) {
            // Запускаем проигрывание текущего трека
            queue.player.play(0, 0, queue.player.tracks.position).catch(console.error);

            // Сообщаем о том что музыка начата с начала
            return ctx.write({
                flags: MessageFlags.Ephemeral,
                embeds: [
                    {
                        description: locale._(ctx.interaction.locale, "player.button.replay", [queue.tracks.track.name]),
                        color: Colors.Green
                    }
                ]
            });
        }

        // Если позиция меньше или равна 0
        if (position <= 0) {
            // Переключаемся на последний трек
            queue.player.play(0, 0, queue.tracks.total - 1).catch(console.error);
        }
        else {
            // Переключаемся на прошлый трек
            queue.player.play(0, 0, position - 1).catch(console.error);
        }

        // Уведомляем пользователя о смене трека
        return ctx.write({
            flags: MessageFlags.Ephemeral,
            embeds: [
                {
                    description: locale._(ctx.interaction.locale, "player.button.last"),
                    color: Colors.Green
                }
            ]
        });
    };
}