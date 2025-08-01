import { CommandInteraction, Colors } from "#structures/discord";
import { middleware } from "#handler/middlewares";
import { Assign, locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Middleware для проверки есть ли очередь
 * @usage Для команд, где требуется очередь
 * @class ExistQueue
 * @extends Assign
 */
class ExistQueue extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "queue",
            callback: async (ctx) => {
                const queue = db.queues.get(ctx.guildId);

                // Если нет очереди
                if (!queue) {
                    await ctx.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(ctx.locale, "middlewares.player.queue.need", [ctx.member]),
                                color: Colors.Yellow
                            }
                        ],
                    });
                    return false;
                }

                return true;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ExistQueue];