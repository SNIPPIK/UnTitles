import { Command, createStringOption, Declare, Options, Locales, Middlewares, CommandContext } from "seyfert";
import { RestClientSide } from "#handler/rest";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Отправка данных в зависимости от текста пользователя
 * @param message - Сообщение
 * @param platform - Платформа
 * @param search - Текст или ссылка пользователя
 */
async function allAutoComplete(message: any, platform: RestClientSide.Request, search: string) {
    // Если платформа заблокирована
    if (platform?.block || !platform?.auth) return;

    // Получаем функцию запроса данных с платформы
    const api = platform.request(search, { audio: false });

    if (!api.type) return;

    try {
        // Получаем данные в системе rest/API
        const rest = await api.request();
        const items: { value: string; name: string }[] = [];

        // Если получена ошибка или нет данных
        if (rest instanceof Error || !rest) return;

        // Обработка массива данных
        if (Array.isArray(rest)) {
            items.push(...rest.map((track) => {
                return {
                    name: `🎵 (${track.time.split}) | ${track.artist.title?.slice(0, 20)} - ${track.name?.slice(0, 60)}`,
                    value: track.url,
                }
            }));
        }

        // Показываем плейлист
        else if ("items" in rest) items.push({
            name: `🎶 [${rest.items.length}] - ${rest.title?.slice(0, 70)}`,
            value: rest.url
        });

        // Показываем трек
        else {
            items.push({
                name: `🎵 (${rest.time.split}) | ${rest.artist.title?.slice(0, 20)} - ${rest.name?.slice(0, 60)}`,
                value: rest.url
            });
        }

        // Отправка ответа
        return message.respond(items);
    } catch (err) {
        console.error(err);
        return null;
    }
}

/**
 * @description Главная команда, включаем музыку
 */
@Declare({
    name: "play",
    description: "Turning on music, or searching for music!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
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
            const search = ctx.getInput();
            // Не даем делать тупые запросы
            if (!search || search.length < 1) return null;

            const platform = db.api.request(search);
            return allAutoComplete(ctx, platform, search);
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
        if (platform.block) {
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