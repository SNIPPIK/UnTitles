import { Assign, CommandInteraction } from "#structures";
import { middleware } from "#handler/middlewares";
import { locale } from "#service/locale";
import { Colors } from "discord.js";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Middleware для проверки проигрывания трека в плеере
 * @class PlayerNotPlaying
 * @extends Assign
 */
class PlayerNotPlaying extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "player-not-playing",
            callback: async (ctx) => {
                const queue = db.queues.get(ctx.guildId);

                // Если музыку нельзя пропустить из-за плеера
                if (!queue && !queue?.player?.playing && db.voice.get(ctx.guildId)) {
                    await ctx.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(ctx.locale, "player.playing.off"),
                                color: Colors.DarkRed
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
 * @author SNIPPIK
 * @description Middleware для проверки загружается ли поток в плеере
 * @class PlayerWait
 * @extends Assign
 */
class PlayerWait extends Assign<middleware<CommandInteraction>> {
    public constructor() {
        super({
            name: "player-wait-stream",
            callback: async (ctx) => {
                const queue = db.queues.get(ctx.guildId);

                // Если музыку нельзя пропустить из-за плеера
                if (queue && queue.player.waitStream) {
                    await ctx.reply({
                        flags: "Ephemeral",
                        embeds: [
                            {
                                description: locale._(ctx.locale, "player.stream.wait"),
                                color: Colors.DarkRed
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
export default [PlayerNotPlaying, PlayerWait];