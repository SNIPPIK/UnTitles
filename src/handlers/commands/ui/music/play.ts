import { Command, CommandContext, Declare, Middlewares, Locales } from "seyfert";
import { ApplicationCommandType } from "seyfert/lib/types";
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
    name: "the-play",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
    type: ApplicationCommandType.Message
})
@Middlewares(["userVoiceChannel", "checkAnotherVoice"])
@Locales({
    name: [
        ["ru", "Воспроизвести"],
        ["en-US", "Play"]
    ]
})
export default class PlayContextCommand extends Command {
    async run(ctx: CommandContext) {
        try {
            const url = ctx.interaction.data.resolved["messages"][ctx.interaction.data["targetId"]].content;
            const parsed = Array.from(url.matchAll(/(https?:\/\/[^\s)]+)/g), m => m[1])[0];

            // Если не найдена ссылка на трек или прочее...
            if (!parsed) {
                return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.support"));
            }

            await ctx.deferReply();

            const platform = db.api.request(parsed);

            // Если не нашлась платформа
            if (!platform) {
                return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.support"));
            }

            // Если платформа заблокирована
            else if (platform.block) {
                return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.block"));
            }

            // Если есть проблема с авторизацией на платформе
            else if (!platform.auth) {
                return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.auth"));
            }

            return ctx.client.events.runCustom("rest/request", platform, ctx, parsed);
        } catch (err) {
            return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.request.fail.msg", [err]));
        }
    };
}