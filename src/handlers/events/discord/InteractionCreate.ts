import type { AnySelectMenuInteraction, AutocompleteInteraction, ButtonInteraction, ChatInputCommandInteraction } from "discord.js";
import { CommandInteraction, Colors } from "#structures/discord";
import { Assign, Logger, locale } from "#structures";
import { ChannelType, Events } from "discord.js"
import { SubCommand } from "#handler/commands";
import { Event } from "#handler/events";
import { db } from "#app/db";

/**
 * @author SNIPPIK
 * @description Класс для взаимодействия бота с slash commands, buttons
 * @class InteractionCreate
 * @extends Assign
 * @event Events.InteractionCreate
 * @public
 */
class Interaction extends Assign<Event<Events.InteractionCreate>> {
    /**
     * @description Создание события
     * @public
     */
    public constructor() {
        super({
            name: Events.InteractionCreate,
            type: "client",
            once: false,
            execute: async (ctx) => {
                // Если включен режим белого списка
                if (db.whitelist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.whitelist.ids.length > 0 && !db.whitelist.ids.includes(ctx.user.id)) {
                        if (!("reply" in ctx)) return;

                        return ctx.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    description: locale._(ctx.locale, "interaction.whitelist", [ctx.member]),
                                    color: Colors.Yellow
                                }
                            ]
                        });
                    }
                }

                // Если включен режим черного списка
                else if (db.blacklist.toggle) {
                    // Если нет пользователя в списке просто его игнорируем
                    if (db.blacklist.ids.length > 0 && !db.blacklist.ids.includes(ctx.user.id)) {
                        if (!("reply" in ctx)) return;

                        return ctx.reply({
                            flags: "Ephemeral",
                            embeds: [
                                {
                                    description: locale._(ctx.locale, "interaction.blacklist", [ctx.member]),
                                    color: Colors.Yellow
                                }
                            ]
                        });
                    }
                }

                // Если используется функция ответа от бота
                if (ctx.isAutocomplete()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run autocomplete ${ctx?.commandName}`);
                    return this.SelectAutocomplete(ctx);
                }

                // Если пользователь использует команду
                else if (ctx.isChatInputCommand()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run command ${ctx?.commandName}`);
                    return this.SelectCommand(ctx);
                }

                // Действия выбора/кнопок
                else if (ctx.isAnySelectMenu || ctx.isButton()) {
                    Logger.log("DEBUG", `[${ctx.user.username}] run component ${ctx?.["customId"]}`);
                    return this.SelectComponent(ctx as any);
                }

                return null;
            }
        });
    };

    /**
     * @description Функция выполняющая действия SelectCommand
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectCommand = async (ctx: ChatInputCommandInteraction) => {
        const command = db.commands.get(ctx.commandName);

        /// Если нет команды
        // Если пользователь пытается использовать команду разработчика
        if (!command || (command.owner && !db.owner.ids.includes(ctx.member.user.id))) {
            db.commands.remove(ctx.client, ctx.commandGuildId, ctx.commandId);

            return ctx.reply({
                flags: "Ephemeral",
                embeds: [{
                    description: locale._(ctx.locale, "interaction.command.fail"),
                    color: Colors.DarkRed
                }]
            });
        }

        // Проверка middleware
        if (command.middlewares?.length) {
            for (const rule of db.middlewares.array) {
                if (command.middlewares.includes(rule.name) && !(await rule.callback(ctx))) {
                    return null;
                }
            }
        }

        // Проверка прав
        if (command.permissions && isBased(ctx) === "guild") {
            const { user: userPerms, client: botPerms } = command.permissions;

            // Проверка прав пользователя
            if (userPerms?.length && !userPerms.every(perm => ctx.member?.permissions?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "interaction.permission.user", [ctx.member]));
            }

            // Проверка прав бота
            if (botPerms?.length && !botPerms.every(perm => ctx.guild?.members.me?.permissionsIn(ctx.channel)?.has(perm))) {
                return ctx.reply(locale._(ctx.locale, "interaction.permission.client", [ctx.member]));
            }
        }

        // Получаем подкоманду (если есть)
        const subcommand: SubCommand = command.options.find((cmd) => cmd.name === ctx.options["_subcommand"]) as any;

        // Запускаем команду
        return (subcommand ?? command).execute({
            message: ctx,
            args: ctx.options?.["_hoistedOptions"]?.map(f => f[f.name] ?? f.value)
        });
    };

    /**
     * @description Функция выполняющая действия SelectAutocomplete
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectAutocomplete = (ctx: AutocompleteInteraction) => {
        const subName = ctx.options["_subcommand"];
        const command = db.commands.get(subName ?? ctx.commandName);
        if (!command) return null;

        // Находим нужную подкоманду, у которой есть autocomplete
        const subcommand = command.options.find(cmd =>
            subName ? cmd.name === subName : cmd.autocomplete
        );
        const groupCommand = subcommand?.options?.find(option => option.autocomplete);

        if (!subcommand && !groupCommand) return null;

        // Извлекаем аргументы сразу без лишней вложенности
        const args = ctx.options?.["_hoistedOptions"]?.map(f => f[f.name] ?? f.value) ?? [];

        // Проверка на пустые аргументы
        if (!args.length || args.some(a => a === "")) return null;

        // Запускаем функцию autocomplete
        return (groupCommand ?? subcommand).autocomplete({
            message: ctx,
            args
        });
    };

    /**
     * @description Функция выполняющая действия компонентов такие как button/selector
     * @param ctx - Данные для запуска функций
     * @readonly
     * @private
     */
    private readonly SelectComponent = async (ctx: ButtonInteraction | AnySelectMenuInteraction) => {
        const component = db.components.get(ctx.customId);

        // Если не найден такой компонент
        if (!component) return null;

        const { middlewares, callback } = component;

        // Делаем проверку ограничений
        if (middlewares?.length > 0) {
            for (const rule of db.middlewares.array) {
                if (middlewares.includes(rule.name) && !(await rule.callback(ctx as any))) {
                    return null;
                }
            }
        }

        // Если компонент был найден
        return callback(ctx);
    };
}

/**
 * @author SNIPPIK
 * @description Получаем тип канала, для работы все сервера
 * @function isBased
 */
function isBased(ctx: CommandInteraction) {
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