import { middleware, MiddlewareResult } from "#handler/middlewares/index.js";
import { Colors } from "#structures/discord/index.js";
import { CommandInteraction } from "discord.js";
import { Assign, locale,  } from "#structures";
import { env } from "#app/env";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description База данных для системы ожидания
 * @private
 */
const cooldown = env.get("cooldown", true) ? {
    time: parseInt(env.get("cooldown.time", "2")),
    db: new Map()
}: null;

/**
 * @author SNIPPIK
 * @description Middleware для проверки спама
 * @class CheckCooldown
 * @extends Assign
 */
class CheckCooldown extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "cooldown",
            callback: (ctx) => {
                // Если пользователь не является разработчиком, то на него будут накладываться штрафы в виде cooldown
                if (!db.owner.ids.includes(ctx.user.id)) {
                    const user = cooldown.db.get(ctx.user.id);

                    // Если нет пользователя в системе ожидания
                    if (!user) {
                        // Добавляем пользователя в систему ожидания
                        cooldown.db.set(ctx.user.id, Date.now() + (cooldown.time * 1e3));
                    }

                    // Если пользователь уже в списке
                    else {
                        // Если время еще не прошло говорим пользователю об этом
                        if (user >= Date.now()) {
                            ctx.reply({
                                flags: "Ephemeral",
                                embeds: [
                                    {
                                        description: locale._(ctx.locale, "interaction.cooldown", [ctx.member, (user / 1000).toFixed(0), 5]),
                                        color: Colors.Yellow
                                    }
                                ]
                            });

                            return MiddlewareResult.fail;
                        }

                        // Удаляем пользователя из базы
                        cooldown.db.delete(ctx.user.id);
                    }

                    return MiddlewareResult.ok;
                }

                return MiddlewareResult.ok;
            }
        });
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [CheckCooldown];