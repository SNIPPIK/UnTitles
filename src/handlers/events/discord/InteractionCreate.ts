import { Colors, SelectMenuInteract, AnyCommandInteraction } from "#structures/discord";
import { DeclareEvent, Event, EventOn, SupportEventCallback } from "#handler/events";
import { AutocompleteInteraction, ButtonInteraction } from "discord.js";
import { ChannelType, Events, InteractionType } from "discord.js";
import { MiddlewareResult } from "#handler/middlewares";
import { Logger, locale } from "#structures";
import { SubCommand } from "#handler/commands";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @extends Event
 * @event Events.InteractionCreate
 * @public
 */
@EventOn()
@DeclareEvent({
    name: Events.InteractionCreate,
    type: "client"
})
class Interaction extends Event<Events.InteractionCreate> {
    run: SupportEventCallback<Events.InteractionCreate> = async (ctx) => {
        /**
         * @description Смотрим тип запроса
         * @protected
         */
        switch (ctx.type) {
            // Если используется функция ответа от бота
            case InteractionType.ApplicationCommandAutocomplete: {
                Logger.log("DEBUG", `[${ctx.user.username}] run autocomplete ${ctx?.commandName}`);
                return this.SelectAutocomplete(ctx).catch((err) => db.commands.onInteractionFail(ctx, err));
            }

            // Если пользователь использует команду
            case InteractionType.ApplicationCommand: {
                Logger.log("DEBUG", `[${ctx.user.username}] run command ${ctx?.commandName}`);
                return this.SelectCommand(ctx).catch((err) => db.commands.onInteractionFail(ctx, err));
            }

            // Действия выбора/кнопок
            case InteractionType.MessageComponent: {
                Logger.log("DEBUG", `[${ctx.user.username}] run component ${ctx.customId} | ${ctx?.["values"]}`);
                return this.SelectComponent(ctx).catch((err) => db.commands.onInteractionFail(ctx, err));
            }

            default: {
                Logger.log("WARN", `User: ${ctx.user.username}, used unsupported type ${ctx.type}`);
                ctx.deleteReply("@original").catch(() => null);
            }
        }
    };

    /**
     * @description Функция выполняющая действия SelectCommand
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectCommand = async (ctx: AnyCommandInteraction) => {
        const command = db.commands.get(ctx.commandName);

        // Если нет команды
        // Если пользователь пытается использовать команду разработчика
        if (!command || (command.owner && !db.owner.ids.includes(ctx.member.user.id))) {
            return db.commands.onCommandFail(ctx);
        }

        // Проверка middleware
        if (command.middlewares?.length > 0) {
            if (!checkMiddlewares(ctx as any, command.middlewares)) return;
        }

        // Проверка прав
        if (command.permissions && isBased(ctx) === "guild") {
            const { user: userPerms, client: botPerms } = command.permissions;
            const memberPerm = ctx.member?.permissions;

            // Проверка прав пользователя
            if (userPerms?.length && typeof memberPerm !== "string"&& !userPerms.every(perm => memberPerm?.has(perm))
            ) {
                return db.commands.onUserPermissionFail(ctx);
            }

            // Проверка прав бота
            if (botPerms?.length &&
                !botPerms.every(perm => ctx.guild?.members.me?.permissionsIn(ctx.channel)?.has(perm))
            ) {
                return db.commands.onClientPermissionFail(ctx);
            }
        }

        // Ищем подкоманду
        const subcommand: SubCommand = command.options?.find((sub) => sub.name === ctx.options["_subcommand"] && "run" in sub) as any;

        // Ищем аргументы
        const args = parseArgs(ctx);

        if (typeof args?.[0] === "string") {
            if (args?.[0]?.startsWith("|") && args?.[0]?.endsWith("|")) {
                return ctx.reply({
                    embeds: [
                        {
                            description: locale._(ctx.locale, "autocomplete.fallback"),
                            color: Colors.DarkRed
                        }
                    ],
                    flags: "Ephemeral"
                })
            }
        }

        // Запускаем команду
        return (subcommand ?? command).run({ ctx: ctx as any, args });
    };

    /**
     * @description Функция выполняющая действия SelectAutocomplete
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectAutocomplete = async (ctx: AutocompleteInteraction): Promise<void> => {
        const command = db.commands.get(ctx.commandName);

        // Если не найдена команда
        if (!command) return null;

        // Ищем аргументы
        const args = parseArgs(ctx);

        if (!args.length) return null;

        const subName = ctx.options["_subcommand"];
        // Проходим по опциям команды один раз
        for (const opt of command.options) {
            // Проверяем, подходит ли нам эта опция по имени или по наличию autocomplete
            const isTarget = subName ? opt.name === subName : opt.autocomplete;

            if (isTarget) {
                // Если у самой опции есть обработчик — вызываем и возвращаем
                if (typeof opt.autocomplete === 'function') {
                    return opt.autocomplete({ ctx, args });
                }

                // Если обработчика нет сверху, ищем во вложенных опциях
                if (opt.options) {
                    for (const subOpt of opt.options) {
                        if (subOpt.autocomplete) {
                            return subOpt.autocomplete({ ctx, args });
                        }
                    }
                }

                // Если нашли цель, но обработчика нигде нет — выходим с null
                return null;
            }
        }

        return null;
    };

    /**
     * @description Функция выполняющая действия компонентов такие как button/selector
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectComponent = async (ctx: ButtonInteraction | SelectMenuInteract) => {
        const component = db.components.get(ctx.customId);
        // Если не найден такой компонент
        if (!component) return null;

        const { middlewares, callback } = component;

        // Делаем проверку ограничений
        if (middlewares?.length > 0) {
            if (!checkMiddlewares(ctx as any, middlewares)) return;
        }

        // Если компонент был найден
        return callback(ctx);
    };
}

/**
 * @author SNIPPIK
 * @description Проверяет, проходят ли переданные middlewares для данного контекста взаимодействия.
 * @param ctx - Контекст взаимодействия Discord (команда, компонент, etc.).
 * @param middlewares - Массив имён middleware, которые нужно проверить.
 * @returns `true`, если все middleware успешно пройдены (колбэк вернул `true`), иначе `false`.
 *
 * @remarks
 * - Middleware регистрируются глобально в `db.middlewares.map`.
 * - Если middleware с указанным именем не найдено, оно игнорируется (пропускается).
 * - Порядок проверки соответствует порядку элементов в массиве `middlewares`.
 *
 * @example
 * ```ts
 * const allowed = checkMiddlewares(interaction, ['userVoiceChannel', 'queueExists']);
 * if (!allowed) return interaction.reply('Access denied');
 * ```
 */
function checkMiddlewares(ctx: Interaction, middlewares: string[]): boolean {
    for (const name of middlewares) {
        const rule = db.middlewares.map.get(name);
        // Если правило существует и его проверка не пройдена – возвращаем false
        if (rule && rule.callback(ctx as any) === MiddlewareResult.fail) return false;
    }
    return true;
}

/**
 * @author SNIPPIK
 * @description Извлекает аргументы команды из контекста взаимодействия Discord.
 * @param ctx - Контекст команды (ChatInput или Autocomplete).
 * @returns Массив строковых значений аргументов в порядке их определения.
 *
 * @remarks
 * - Для `ChatInputCommandInteraction` и `AutocompleteInteraction` используется внутреннее поле `_hoistedOptions`,
 *   которое содержит нормализованный список опций.
 * - Если опция называется `type`, возвращается её значение, иначе – значение опции с ключом, равным её имени,
 *   либо просто `value`.
 * - Если опции отсутствуют, возвращается пустой массив.
 *
 * @note
 * Поле `_hoistedOptions` является внутренним для Discord.js и может измениться в будущих версиях.
 * В production-коде рекомендуется использовать официальный API `ctx.options.getString()` и т.п.
 * Данная функция используется для обратной совместимости и удобства в специфичных сценариях.
 *
 * @example
 * ```ts
 * const args = parseArgs(interaction);
 * const [user, duration] = args; // ["@someone", "60"]
 * ```
 */
function parseArgs(ctx: AnyCommandInteraction | AutocompleteInteraction): string[] {
    return ctx.options?.["_hoistedOptions"]?.map(f => f.name === "type" ? f.value : f[f.name] ?? f.value) ?? [];
}

/**
 * @author SNIPPIK
 * @description Получаем тип канала, для работы все сервера
 * @function isBased
 */
function isBased(ctx: AnyCommandInteraction) {
    const type = ctx.channel?.type;

    // Проверяем на наличие типа канала
    if (type !== undefined) {
        // Если используется на сервере
        if (type === ChannelType.GuildText || type === ChannelType.GuildAnnouncement || type === ChannelType.GuildStageVoice || type === ChannelType.GuildVoice) return "guild";

        // Если используется в личном чате
        else if (type === ChannelType.PrivateThread) return "private";
    }

    // Если используется на стороннем сервере
    return "public";
}

/**
 * @export default
 * @description Делаем классы глобальными
 */
export default [Interaction];