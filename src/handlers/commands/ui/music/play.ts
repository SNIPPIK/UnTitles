import { Command, CommandContext, Declare, Middlewares, Permissions } from "#handler/commands";
import { ApplicationCommandType, Message } from "discord.js";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Базовое включение музыки из сообщения
 * @class PlayContextCommand
 * @extends Assign
 * @public
 */
@Declare({
    names: {
        "en-US": "Play",
        "ru": "Воспроизвести"
    },
    integration_types: ["GUILD_INSTALL"],
    type: ApplicationCommandType.Message
})
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class PlayContextCommand extends Command {
    async run({ctx, args}: CommandContext<Message>) {
        const url = Array.from(args[0].content.matchAll(/(https?:\/\/[^\s)]+)/g), m => m[1])[0];
        await ctx.deferReply();

        // Если не найдена ссылка на трек или прочее...
        if (!url) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.support"));
            return null;
        }

        const platform = db.api.request(url);

        // Если не нашлась платформа
        if (!platform) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.support"));
            return null;
        }

        // Если платформа заблокирована
        else if (platform.block) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.block"));
            return null;
        }

        // Если есть проблема с авторизацией на платформе
        else if (!platform.auth) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.auth"));
            return null;
        }

        db.events.emitter.emit("rest/request", platform, ctx, url);
        return null;
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ PlayContextCommand ];