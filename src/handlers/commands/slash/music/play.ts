import {
    Command,
    CommandCallback,
    CommandIntegration,
    Declare,
    Middlewares,
    Options,
    Permissions,
    SubCommand
} from "#handler/commands";
import { ApplicationCommandOptionType } from "discord.js";
import radio from "#core/player/stations.json";
import { locale } from "#structures";
import { db } from "#app/db";

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
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: db.api.array_prev.map((platform) => {
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
            if (!args[1] || args[1] === "") {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.null"),
                        value: "|CRITICAL_ERROR|"
                    }
                ])
            }

            const platform = db.api.request(args[0]);
            return db.commands.playAutocomplete(ctx, platform, args[1]);
        }
    }
})
class PlaySearchCommand extends SubCommand {
    async run({ctx, args}: CommandCallback) {
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
        type: ApplicationCommandOptionType.String,
        required: true,
        choices: db.api.array_related.map((platform) => {
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
        type: ApplicationCommandOptionType.String,
        autocomplete: ({ctx, args}) => {
            if (!args[1] || args[1] === "") {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.null"),
                        value: "|CRITICAL_ERROR|"
                    }
                ])
            }

            const platform = db.api.request(args[0]);
            return db.commands.playAutocomplete(ctx, platform, args[1]);
        }
    }
})
class PlayRelatedCommand extends SubCommand {
    async run({ctx, args}: CommandCallback) {
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

        db.events.emitter.emit("rest/request", platform, ctx, `${args[1]}&list=RD`);
        return null;
    };
}


/**
 * @description Под команда включения радио станций
 * @type SubCommand
 */
@Declare({
    names: {
        "en-US": "radio",
        "ru": "радио"
    },
    descriptions: {
        "en-US": "Play radio",
        "ru": "Play radio"
    }
})
@Options({
    select: {
        names: {
            "en-US": "station",
            "ru": "станция"
        },
        descriptions: {
            "en-US": "Which station shall we listen to?",
            "ru": "Какую станцию будем слушать?"
        },
        type: ApplicationCommandOptionType.String,
        required: true,
        autocomplete: ({ctx, args}) => {
            // Исправляем: берем значение более безопасно
            const focusedValue = args[0] as string;
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
    }
})
class PlayRadioCommand extends SubCommand {
    async run({ctx, args}: CommandCallback) {
        const search: string = args[0];
        const platform = db.api.request("RADIO");
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

        db.events.emitter.emit("rest/request", platform, ctx, search);
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
    integration_types: [CommandIntegration.Guild]
})
@Options([PlaySearchCommand, PlayRelatedCommand, PlayRadioCommand])
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["Connect", "Speak", "SendMessages", "ViewChannel"]
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
    integration_types: [CommandIntegration.Guild]
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
        type: ApplicationCommandOptionType.String,
        autocomplete: ({ctx, args}) => {
            if (!args[0] || args[0] === "") {
                return ctx.respond([
                    {
                        name: locale._(ctx.locale, "autocomplete.null"),
                        value: "|CRITICAL_ERROR|"
                    }
                ])
            }

            const platform = db.api.request(args[0]);
            return db.commands.playAutocomplete(ctx, platform, args[0]);
        }
    }
})
@Middlewares(["cooldown", "voice", "another_voice"])
@Permissions({
    client: ["Connect", "Speak", "SendMessages", "ViewChannel"],
})
class PlayCommand extends Command {
    async run({ctx, args}: CommandCallback) {
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