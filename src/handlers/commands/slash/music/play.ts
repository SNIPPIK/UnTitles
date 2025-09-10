import { Command, CommandContext, Declare, Middlewares, Options, Permissions, SubCommand } from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import { CompeteInteraction } from "#structures/discord";
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
async function allAutoComplete(message: CompeteInteraction, platform: RestClientSide.Request, search: string) {
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
                    name: `🎵 (${track.time.split}) | ${track.artist.title.slice(0, 20)} - ${track.name.slice(0, 60)}`,
                    value: track.url,
                }
            }));
        }

        // Показываем плейлист
        else if ("items" in rest) items.push({
            name: `🎶 [${rest.items.length}] - ${rest.title.slice(0, 70)}`,
            value: search
        });

        // Показываем трек
        else {
            items.push({
                name: `🎵 (${rest.time.split}) | ${rest.artist.title.slice(0, 20)} - ${rest.name.slice(0, 60)}`,
                value: search
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
 * @description Под команда поиска трека
 * @type SubCommand
 */
@Declare({
    names: {
        "en-US": "search",
        "ru": "поиск"
    },
    descriptions: {
        "en-US": "Turn on music by link or title!",
        "ru": "Включение музыки по ссылке или названию!"
    }
})
@Options({
    select: {
        names: {
            "en-US": "select",
            "ru": "платформа"
        },
        descriptions: {
            "en-US": "Which platform does the request belong to?",
            "ru": "К какой платформе относится запрос?"
        },
        type: ApplicationCommandOptionType["String"],
        required: true,
        choices: db.api.array.map((platform) => {
            return {
                name: `${platform.name.toLowerCase()} | ${platform.url}`,
                value: platform.name
            }
        })
    },
    request: {
        names: {
            "en-US": "request",
            "ru": "запрос"
        },
        descriptions: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        required: true,
        type: ApplicationCommandOptionType["String"],
        autocomplete: ({ctx, args}) => {
            if (!args[1] || args[1] === "") return null;

            const platform = db.api.request(args[0]);
            return allAutoComplete(ctx, platform, args[1]);
        }
    }
})
class PlaySearchCommand extends SubCommand {
    async run({ctx, args}: CommandContext) {
        const platform = db.api.request(args[0]);
        await ctx.deferReply();

        // Если платформа заблокирована
        if (platform.block) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.block"));
            return null;
        }

        // Если есть проблема с авторизацией на платформе
        else if (!platform.auth) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.auth"));
            return null;
        }

        db.events.emitter.emit("rest/request", platform, ctx, args[1]);
        return null;
    };
}


/**
 * @description Под команда включения похожих треков
 * @type SubCommand
 */
@Declare({
    names: {
        "en-US": "related",
        "ru": "похожее"
    },
    descriptions: {
        "en-US": "Endless track playback mode!",
        "ru": "Добавление себе подобных треков!"
    },
})
@Options({
    select: {
        names: {
            "en-US": "select",
            "ru": "платформа"
        },
        descriptions: {
            "en-US": "Which platform does the request belong to?",
            "ru": "К какой платформе относится запрос?"
        },
        type: ApplicationCommandOptionType["String"],
        required: true,
        choices: db.api.arrayRelated.map((platform) => {
            return {
                name: `${platform.name.toLowerCase()} | ${platform.url}`,
                value: platform.name
            }
        })
    },
    request: {
        names: {
            "en-US": "request",
            "ru": "запрос"
        },
        descriptions: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        required: true,
        type: ApplicationCommandOptionType["String"],
        autocomplete: ({ctx, args}) => {
            if (!args[1] || args[1] === "") return null;

            const platform = db.api.request(args[0]);
            return allAutoComplete(ctx, platform, args[1]);
        }
    }
})
class PlayRelatedCommand extends SubCommand {
    async run({ctx, args}: CommandContext) {
        const platform = db.api.request(args[0] as any);
        await ctx.deferReply();

        // Если платформа заблокирована
        if (platform.block) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.block"));
            return null;
        }

        // Если есть проблема с авторизацией на платформе
        else if (!platform.auth) {
            db.events.emitter.emit("rest/error", ctx, locale._(ctx.locale, "api.platform.auth"));
            return null;
        }

        db.events.emitter.emit("rest/request", platform, ctx, `${args[1]}&list=RD`);
        return null;
    };
}


/**
 * @author SNIPPIK
 * @description Расширенное включение музыки
 * @class PlayAdvancedCommand
 * @extends Command
 * @public
 */
@Declare({
    names: {
        "en-US": "plау",
        "ru": "игрaть"
    },
    descriptions: {
        "en-US": "Advanced control of music inclusion!",
        "ru": "Расширенное управление включение музыки!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@Options([PlaySearchCommand, PlayRelatedCommand])
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class PlayAdvancedCommand extends Command {
    async run() {}
}


/**
 * @author SNIPPIK
 * @description Базовое включение музыки
 * @class PlayCommand
 * @extends Assign
 * @public
 */
@Declare({
    names: {
        "en-US": "play",
        "ru": "играть"
    },
    descriptions: {
        "en-US": "Turning on music, or searching for music!",
        "ru": "Включение музыки, или поиск музыки!"
    },
    integration_types: ["GUILD_INSTALL"]
})
@Options({
    request: {
        names: {
            "en-US": "request",
            "ru": "запрос"
        },
        descriptions: {
            "en-US": "You must specify the link or the name of the track!",
            "ru": "Необходимо указать ссылку или название трека!"
        },
        required: true,
        type: ApplicationCommandOptionType["String"],
        autocomplete: ({ctx, args}) => {
            const platform = db.api.request(args[0]);
            return allAutoComplete(ctx, platform, args[0]);
        }
    }
})
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["SendMessages", "ViewChannel"]
})
class PlayCommand extends Command {
    async run({ctx, args}: CommandContext) {
        const platform = db.api.request(args[0]);
        await ctx.deferReply();

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

        db.events.emitter.emit("rest/request", platform, ctx, args[0]);
        return null;
    };
}

/**
 * @export default
 * @description Не даем классам или объектам быть доступными везде в проекте
 */
export default [ PlayCommand, PlayAdvancedCommand ];