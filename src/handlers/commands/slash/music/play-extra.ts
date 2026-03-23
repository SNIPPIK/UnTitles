import { Locales, Command, SubCommand, type AutocompleteInteraction, createStringOption, Declare, Options, Middlewares, CommandContext } from "seyfert";
import { RestClientSide } from "#handler/rest";
import radio from "#core/player/stations.json";
import { locale } from "#structures";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Отправка данных в зависимости от текста пользователя
 * @param message - Сообщение
 * @param platform - Платформа
 * @param search - Текст или ссылка пользователя
 */
async function allAutoComplete(message: AutocompleteInteraction, platform: RestClientSide.Request, search: string) {
    // Получаем функцию запроса данных с платформы
    const api = platform.request(search, { audio: false });

    if (!api.type) return;

    try {
        // Получаем данные в системе rest/API
        const rest = await api.request();

        // Если была получена ошибка
        if (rest instanceof Error) {
            return message.respond([
                {
                    name: `[REST/API] -> ${rest}`.slice(0, 120),
                    value: search,
                }
            ]);
        }

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
        return;
    }
}

/**
 * @description Подкоманда для включения музыки через конкретную платформу
 */
@Declare({
    name: "search",
    description: "Turn on music by link or title!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Options({
    platform: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "select",
            "ru": "платформа"
        },
        description: "Which platform does the request belong to?",
        description_localizations: {
            "en-US": "Which platform does the request belong to?",
            "ru": "К какой платформе относится запрос?"
        },
        choices: db.api.array.map((platform) => {
            return {
                name: `${platform.name.toLowerCase()} | ${platform.url}`,
                value: platform.name
            }
        })
    }),
    request: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "request",
            "ru": "запрос"
        },
        description: "You must specify the link or the name of the track!",
        description_localizations: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        autocomplete: (ctx) => {
            if (!ctx.options.hoistedOptions[1].value || ctx.options.hoistedOptions[1].value === "") return null;

            const platform = db.api.request(ctx.options.hoistedOptions[0].value as any);
            return allAutoComplete(ctx, platform, ctx.options.hoistedOptions[1].value as string);
        }
    })
})
@Locales({
    name: [
        ["ru", "поиск"],
        ["en-US", "search"]
    ],
    description: [
        ["ru", "Включение музыки по ссылке или названию!"],
        ["en-US", "Turn on music by link or title!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
class PlaySearchCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const search: string = ctx.options["request"];
        const platform = db.api.request(ctx.options["platform"])

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

/**
 * @description Подкоманда для включения музыки через конкретную платформу
 */
@Declare({
    name: "wave",
    description: "Endless track playback mode!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Options({
    platform: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "select",
            "ru": "платформа"
        },
        description: "Which platform does the request belong to?",
        description_localizations: {
            "en-US": "Which platform does the request belong to?",
            "ru": "К какой платформе относится запрос?"
        },
        choices: db.api.arrayRelated.map((platform) => {
            return {
                name: `${platform.name.toLowerCase()} | ${platform.url}`,
                value: platform.name
            }
        })
    }),
    request: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "request",
            "ru": "запрос"
        },
        description: "You must specify the link or the name of the track!",
        description_localizations: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        autocomplete: (ctx) => {
            if (!ctx.options.hoistedOptions[1].value || ctx.options.hoistedOptions[1].value === "") return null;

            const platform = db.api.request(ctx.options.hoistedOptions[0].value as any);
            return allAutoComplete(ctx, platform, ctx.options.hoistedOptions[1].value as string);
        }
    })
})
@Locales({
    name: [
        ["ru", "похожее"],
        ["en-US", "related"]
    ],
    description: [
        ["ru", "Добавление себе подобных треков!"],
        ["en-US", "Endless track playback mode!"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
class PlayRelatedCommand extends SubCommand {
    async run(ctx: CommandContext) {
        const search: string = ctx.options["request"];
        const platform = db.api.request(search);
        await ctx.deferReply();

        // Если платформа заблокирована
        if (platform.block) {
            return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.block"));
        }

        // Если есть проблема с авторизацией на платформе
        else if (!platform.auth) {
            return ctx.client.events.runCustom("rest/error", ctx, locale._(ctx.interaction.locale, "api.platform.auth"));
        }

        return ctx.client.events.runCustom("rest/request", platform, ctx, `${search}&list=RD`);
    }
}


/**
 * @description Подкоманда для включения музыки через конкретную платформу
 */
@Declare({
    name: "radio",
    description: "Play radio",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"]
})
@Options({
    station: createStringOption({
        required: true,
        name_localizations: {
            "en-US": "station",
            "ru": "станция"
        },
        description: "Find your radio station",
        description_localizations: {
            "en-US": "Which station shall we listen to?",
            "ru": "Какую станцию будем слушать?"
        },
        autocomplete: (ctx) => {
            // Исправляем: берем значение более безопасно
            const focusedValue = ctx.options.getString("station");
            const search = focusedValue.toLowerCase();

            // Фильтруем станции. Используем includes для простоты или RegExp с защитой
            const waves = radio.filter((p) =>
                p.name.toLowerCase().includes(search) ||
                (p.locale[ctx.locale]?.toLowerCase().includes(search))
            );

            // Discord ограничивает автокомплит 25 элементами
            return ctx.respond(waves.slice(0, 25).map((d) => ({
                name: d.name,
                value: d.name // Передаем имя как уникальный идентификатор
            })));
        }
    })
})
@Locales({
    name: [
        ["ru", "радио"],
        ["en-US", "radio"]
    ],
    description: [
        ["ru", "Включение радиостанции"],
        ["en-US", "Turning on the radio station"]
    ]
})
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
class PlayRadio extends SubCommand {
    async run(ctx: CommandContext) {
        const search: string = ctx.options["station"];
        const platform = db.api.request("RADIO");

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


/**
 * @description Главная команда, идет как группа
 */
@Declare({
    name: "plaу",
    description: "Playing music!",
    integrationTypes: ["GuildInstall"],
    botPermissions: ["SendMessages", "Speak", "Connect", "ViewChannel"],
})
@Locales({
    name: [
        ["ru", "игрaть"],
        ["en-US", "plaу"]
    ],
    description: [
        ["ru", "Расширенное управление включение музыки!"],
        ["en-US", "Advanced control of music inclusion!"]
    ]
})
@Options([PlaySearchCommand, PlayRelatedCommand, PlayRadio])
@Middlewares(["userVoiceChannel", "clientVoiceChannel", "checkAnotherVoice"])
export default class PlayCommand extends Command {
    async run() {}
}