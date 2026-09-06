import { Command, createStringOption, Declare, Options, Locales, Middlewares, CommandContext } from "seyfert";
import { locale } from "#structures";
import { db } from "#db";

/**
 * @description Главная команда, включаем музыку
 */
@Declare({
    name: "play",
    description: "Turning on music, or searching for music!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
    defaultMemberPermissions: ["ViewChannel", "SendMessages", "Connect", "Speak"],
})
@Options({
    query: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "request",
            "ru": "запрос"
        },
        description: "Playing music",
        description_localizations: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        autocomplete: (ctx) => {
            try {
                const search = ctx.getInput();
                // Не даем делать тупые запросы
                if (!search || search.length < 1) {
                    return ctx.respond([
                        {
                            name: locale._(ctx.locale, "autocomplete.null"),
                            value: "|CRITICAL_ERROR|"
                        }
                    ])
                }

                const platform = db.api.request(search);
                return db.commands.playAutocomplete(ctx, platform, search);
            } catch (err) {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.null"),
                        value: "|CRITICAL_ERROR|"
                    }
                ])
            }
        },
    })
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
@Locales({
    name: [
        ["ru", "играть"],
        ["en-US", "play"]
    ],
    description: [
        ["ru", "Включение музыки, или поиск музыки!"],
        ["en-US", "Turning on music, or searching for music!"]
    ]
})
export default class PlayCommand extends Command {
    async run(ctx: CommandContext) {
        const search: string = ctx.options["query"];
        const platform = db.api.request(search);

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

        await ctx.deferReply();
        return ctx.client.events.runCustom("rest/request", platform, ctx, search);
    }
}